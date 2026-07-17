/**
 * Retry-after parsing + jittered backoff for LLM API rate-limit handling.
 *
 * Shared by OpenAICompatibleAdapter and AnthropicAdapter. Centralised so the
 * two adapters can never diverge on retry discipline — which is what prevents
 * provider bans: a strict provider (Volcengine, some OpenAI proxies) bans
 * clients that 429-then-retry-on-their-own-clock without honouring the
 * server's `Retry-After`. Every retryable HTTP path MUST go through here.
 *
 * Design (see docs/llm-concurrency-adaptive-limiter-2026-06-26.md §6):
 *   1. Prefer the server's `Retry-After` (seconds OR HTTP-date) when present.
 *   2. Fall back to exponential backoff only when the server gives no hint.
 *   3. Always add jitter so concurrent retries don't synchronise into a
 *      thundering herd — a classic ban trigger.
 *   4. Clamp to an upper bound so a misbehaving server can't stall us forever.
 */

/**
 * Maximum backoff we'll ever honour for a NORMAL retry, even if Retry-After
 * says more. 5 min. Overridable via env.
 *
 * NOTE: this default ceiling is deliberately conservative so a misbehaving
 * server can't stall the pipeline forever on a transient blip. For genuine
 * capacity/rate-limit paths (e.g. an hourly rolling quota where the server
 * explicitly tells us to wait hours) use computeBackoffMs(..., {capacityMode})
 * which raises the ceiling to LLM_CAPACITY_RETRY_MAX_MS (default 6h).
 */
const MAX_BACKOFF_MS = readPositiveIntEnv("LLM_RETRY_AFTER_MAX_MS", 5 * 60 * 1000);

/**
 * Higher ceiling for capacity/rate-limit backoffs. Some providers (e.g.
 * Anthropic's 5-hour rolling window, or hourly quota resets) genuinely need
 * hours of waiting, and retrying early just wastes quota and risks a ban.
 * Default 6h covers a 5h window with margin. Overridable via env.
 */
const CAPACITY_RETRY_MAX_MS = readPositiveIntEnv("LLM_CAPACITY_RETRY_MAX_MS", 6 * 60 * 60 * 1000);

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Jitter range: ±25% of the base delay. */
const JITTER_FRACTION = 0.25;

/** Options for parseRetryAfterMs / computeBackoffMs. */
export interface RetryAfterOptions {
  /**
   * When true, honour long server-provided Retry-After values (up to
   * LLM_CAPACITY_RETRY_MAX_MS, default 6h) instead of clamping to the 5-min
   * normal ceiling. Use this on paths where the failure is a genuine
   * capacity/rate-limit signal (429/503 with a long Retry-After), NOT for
   * transient network blips.
   */
  capacityMode?: boolean;
}

/**
 * Parse a `Retry-After` header value into milliseconds.
 *
 * RFC 7231 allows two forms:
 *   - delta-seconds: "120"  → 120_000 ms
 *   - HTTP-date:      "Wed, 21 Oct 2026 07:28:00 GMT"
 *
 * Returns `null` when absent or unparseable (caller falls back to exp backoff).
 * A date in the past is clamped to 0 (retry immediately) rather than rejected
 * — the server is signalling "no additional delay needed".
 *
 * The clamp ceiling is MAX_BACKOFF_MS (5 min) normally, or
 * CAPACITY_RETRY_MAX_MS (6h) when opts.capacityMode is set — so a provider
 * enforcing an hourly/hours-long rolling quota is actually respected.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  opts?: RetryAfterOptions,
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ceiling = opts?.capacityMode ? CAPACITY_RETRY_MAX_MS : MAX_BACKOFF_MS;

  // Form 1: pure integer = delta-seconds.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, ceiling);
  }

  // Form 2: HTTP-date (RFC 7231 IMF-fixdate, e.g. "Wed, 21 Oct 2026 ...").
  // A legitimate HTTP-date always contains alphabetic month/day tokens, so a
  // bare numeric-ish string ("-10", "1.5") can't be one — reject before
  // Date.parse, which on V8 will happily coerce some garbage into a timestamp.
  if (!/[a-z]/i.test(trimmed)) return null;
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return Math.max(0, Math.min(delta, ceiling));
}

/**
 * Decide the delay (ms) to wait before the next retry, honouring Retry-After
 * when the server provided one and applying exponential backoff otherwise.
 *
 * @param retryAfterHeader  Raw `Retry-After` header value (may be null).
 * @param attemptRemaining  Decrements each retry (e.g. 3,2,1). Indexes the
 *                          exponential fallback so the first retry waits
 *                          longest-progression-first, matching the prior
 *                          `Math.pow(2, 4 - remaining)` schedule for parity.
 * @param now               Injected for deterministic tests.
 * @param opts.capacityMode Raise the Retry-After ceiling for capacity paths.
 */
export function computeBackoffMs(
  retryAfterHeader: string | null | undefined,
  attemptRemaining: number,
  now: number = Date.now(),
  opts?: RetryAfterOptions,
): number {
  const serverHint = parseRetryAfterMs(retryAfterHeader, opts);
  if (serverHint !== null) {
    // Server is authoritative — honour it, but still add small jitter so a
    // fleet of concurrent retries that all hit the same Retry-After don't
    // land on the exact same millisecond.
    return applyJitter(serverHint);
  }

  // Exponential fallback: 2s, 4s, 8s for attemptRemaining 3,2,1 (matches the
  // prior hardcoded schedule so existing retry counts keep their cadence).
  const base = Math.pow(2, 4 - Math.max(1, Math.min(attemptRemaining, 3))) * 1000;
  const clamped = Math.min(base, MAX_BACKOFF_MS);
  return applyJitter(clamped);
}

/** Add ±25% jitter to a base delay to decorrelate concurrent retries. */
function applyJitter(baseMs: number): number {
  const spread = baseMs * JITTER_FRACTION;
  const offset = (Math.random() * 2 - 1) * spread;
  return Math.max(0, Math.round(baseMs + offset));
}

/** Sleep helper. Exported so tests can stub timing if needed. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Signal-aware delay: resolves after `ms` unless `signal` aborts first, in
 * which case rejects immediately with an AbortError. Used by retry loops so a
 * cancelled task doesn't wait out the full backoff window.
 */
export function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return delay(ms);
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Detect a "balance exhausted / quota spent" response — i.e. the account is
 * OUT of money/quota (not temporarily rate-limited). Providers signal this via
 * HTTP 402 Payment Required, or 429/403 with a body containing markers like
 * `insufficient_quota`, `billing`, `balance`, `credit` (OpenAI returns
 * "insufficient_quota"; many Chinese providers return 429 + "余额不足").
 *
 * Such failures are NOT retryable — waiting (even hours via capacityMode)
 * won't help until the user tops up. Callers should fail fast with a clear
 * "account balance insufficient" message instead of retrying.
 *
 * Kept intentionally narrow: only matches when the status is billing-adjacent
 * (402/403/429) AND the body carries an unambiguous billing marker, so ordinary
 * rate-limit 429s (which lack these markers) still retry normally.
 */
const BALANCE_MARKERS = [
  "insufficient_quota",
  "insufficient quota",
  "billing",
  "balance",
  "余额不足",
  "充值",
  "credit",
  "payment_required",
  "payment required",
  "exceeded your current quota",
  "no enough balance",
  "account inactive",
];

export function isBalanceExhausted(status: number, body: string): boolean {
  if (status !== 402 && status !== 403 && status !== 429) return false;
  const lower = body.toLowerCase();
  return BALANCE_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}
