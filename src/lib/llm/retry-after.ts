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

/** Maximum backoff we'll ever honour, even if Retry-After says more. 5 min. */
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Jitter range: ±25% of the base delay. */
const JITTER_FRACTION = 0.25;

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
 */
export function parseRetryAfterMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Form 1: pure integer = delta-seconds.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }

  // Form 2: HTTP-date (RFC 7231 IMF-fixdate, e.g. "Wed, 21 Oct 2026 ...").
  // A legitimate HTTP-date always contains alphabetic month/day tokens, so a
  // bare numeric-ish string ("-10", "1.5") can't be one — reject before
  // Date.parse, which on V8 will happily coerce some garbage into a timestamp.
  if (!/[a-z]/i.test(trimmed)) return null;
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return Math.max(0, Math.min(delta, MAX_BACKOFF_MS));
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
 */
export function computeBackoffMs(
  retryAfterHeader: string | null | undefined,
  attemptRemaining: number,
  now: number = Date.now(),
): number {
  const serverHint = parseRetryAfterMs(retryAfterHeader);
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
