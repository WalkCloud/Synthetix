/**
 * Adaptive per-provider concurrency limiter (weighted, AIMD-based).
 *
 * This is the core mechanism of docs/llm-concurrency-adaptive-limiter-2026-06-26.md.
 * Why it exists: providers don't publish their concurrency/TPM limits and they
 * differ wildly. A static value is always wrong — too low wastes throughput
 * (wiki's serial loop being the extreme), too high triggers 429s (which waste
 * quota and risk bans on strict providers like Volcengine).
 *
 * Design principles (see the design doc §4–§6):
 *
 *   1. WEIGHTED window, not request count. A single long-output graph request
 *      can eat a whole minute's TPM. Counting only in-flight REQUESTS would
 *      still 429 on the TPM axis. So the window is denominated in *tokens*:
 *      acquire(estTokens) reserves budget, release(actualTokens) settles.
 *
 *   2. Layered signals, cheapest first:
 *        - Success responses carry x-ratelimit-remaining-* → feed-forward,
 *          adjust budget proactively, ideally zero 429s.
 *        - Latency gradient (P95 rising) → provider is queuing → back off
 *          BEFORE a 429 (lossless signal, costs nothing).
 *        - 429 itself → multiplicative decrease (the tuition we try to avoid).
 *
 *   3. slow-start to find the ceiling fast: budget DOUBLES until first
 *      friction (log-N requests), then switches to additive increase. Much
 *      cheaper than linear AIMD probing.
 *
 *   4. Persisted ceiling — the tuition is paid ONCE per provider. Restarts
 *      and sibling processes start at the known ceiling × headroom.
 *
 *   5. single-flight cooldown on 429: one request's 429 freezes the whole
 *      provider's window for Retry-After, so concurrent requests don't
 *      thundering-herd the provider (the actual ban trigger).
 *
 * Concurrency model: each provider gets ONE AdaptiveLimiter instance (process-
 * global). All Node callers (wiki, embed, graph-via-adapter, draft) sharing a
 * provider share that instance — matching how the provider itself sees load.
 */

import { Semaphore } from "@/lib/concurrency/limiter";
import { delay } from "./retry-after";
import {
  updateCapacity,
  readCapacity,
  type ProviderCapacityRecord,
} from "./provider-capacity-store";
import type { RateLimitInfo } from "./rate-limit-headers";

// ── Tunables (overridable via env) ──────────────────────────────────────────

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function readFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const FLOOR_TOKENS = readPositiveIntEnv("LLM_LIMITER_FLOOR_TOKENS", 4_000);
const SLOW_START_SUCCESSES = readPositiveIntEnv("LLM_LIMITER_SLOW_START_K", 8);
const AI_SUCCESSES = readPositiveIntEnv("LLM_LIMITER_AI_K", 20);
const MD_FACTOR = readFloatEnv("LLM_LIMITER_MD_FACTOR", 0.75);
const LATENCY_FACTOR = readFloatEnv("LLM_LIMITER_LATENCY_FACTOR", 0.9);
const HEADROOM = readFloatEnv("LLM_LIMITER_HEADROOM", 0.8);
const LATENCY_THRESHOLD = readFloatEnv("LLM_LIMITER_LATENCY_THRESHOLD", 1.5);
/** One "additive increase" step in tokens (≈ one medium request). */
const AI_STEP_TOKENS = readPositiveIntEnv("LLM_LIMITER_AI_STEP_TOKENS", 4_000);
/** Max budget we'll ever allow, even if the provider seems infinite. */
const CEILING_CAP_TOKENS = readPositiveIntEnv("LLM_LIMITER_CEILING_CAP_TOKENS", 500_000);
/**
 * Hard cap on IN-FLIGHT REQUEST COUNT per provider. This is the load-bearing
 * safety rail: the token-budget path can be bypassed when a single request
 * exceeds the budget (the "big request let-through" in reserveTokens), so
 * without a tight request cap, N concurrent callers each issuing large
 * requests would all sail through and overwhelm the provider. Strict providers
 * (Volcengine) respond to over-concurrency by HOLDING connections open without
 * replying (not even a 429), which stalls the whole pipeline until the 5-min
 * fetch timeout.
 *
 * Default 2 is deliberately conservative: most LLM providers tolerate 2-3
 * concurrent requests reliably; raising it risks the hold-open stall. The
 * Node side (wiki/embed/draft) and Python side (graph) hit the SAME provider
 * account, so their caps are additive — keep the sum under the provider's real
 * limit. Override per-deployment via LLM_LIMITER_MAX_REQUESTS.
 */
const MAX_REQUEST_CONCURRENCY = readPositiveIntEnv("LLM_LIMITER_MAX_REQUESTS", 2);
/** How often (ms) to persist a record even if only the budget drifted. */
const PERSIST_INTERVAL_MS = 30_000;

// ── Types ───────────────────────────────────────────────────────────────────

export interface AcquireOptions {
  /** Estimated tokens this request will consume (prompt + expected output). */
  estimatedTokens: number;
}

export interface ReleaseInfo {
  /** Actual tokens consumed (from response.usage). */
  actualTokens: number;
  /** HTTP status of the response. */
  status: number;
  /** Response latency in ms (for the latency-gradient signal). */
  latencyMs?: number;
  /** Parsed rate-limit headers, if any. */
  rateLimit?: RateLimitInfo;
}

type Phase = "slow-start" | "additive" | "cooldown";

// ── The limiter ─────────────────────────────────────────────────────────────

export class AdaptiveLimiter {
  /** Provider identity this limiter bounds. */
  readonly providerKey: string;

  /** Current operating budget (tokens). Acquires block until this much is free. */
  private budgetTokens: number;
  /** Tokens currently reserved by in-flight requests. */
  private inflightTokens = 0;

  /** Highest budget sustained without friction (the probed ceiling). */
  private ceilingTokens: number;

  /** Slow-start / additive bookkeeping. */
  private phase: Phase;
  private consecutiveSuccesses = 0;

  /** Latency baseline (EWMA) + recent samples for P95. */
  private latencyEwma = 0;
  private latencySamples: number[] = [];

  /** single-flight cooldown: all acquires block until this epoch ms. */
  private cooldownUntil = 0;

  /** Budget semaphore: one permit per in-flight request (caps request count
   *  as a SECONDARY limit on top of the token budget — even tiny requests
   *  can't exceed a sane request concurrency). */
  private readonly requestSlots: Semaphore;
  /** Serialises budget mutations so concurrent releases don't race. */
  private readonly budgetLock = new Semaphore(1);

  private lastPersistAt = 0;
  private lastPersistedBudget = 0;

  constructor(providerKey: string, opts?: {
    initialBudget?: number;
    initialCeiling?: number;
    maxRequestConcurrency?: number;
  }) {
    this.providerKey = providerKey;
    this.budgetTokens = opts?.initialBudget ?? FLOOR_TOKENS;
    this.ceilingTokens = opts?.initialCeiling ?? FLOOR_TOKENS;
    this.phase = this.budgetTokens > FLOOR_TOKENS ? "additive" : "slow-start";
    this.requestSlots = new Semaphore(opts?.maxRequestConcurrency ?? MAX_REQUEST_CONCURRENCY);
  }

  /**
   * Reserve capacity for a request. Resolves when both:
   *   - the provider is not in cooldown (single-flight), AND
   *   - enough token budget + a request slot are free.
   * Returns a release function that MUST be called exactly once with the
   * actual outcome, so the AIMD loop can learn.
   */
  async acquire(opts: AcquireOptions): Promise<(info?: ReleaseInfo) => Promise<void>> {
    const want = Math.max(opts.estimatedTokens, 1);

    // 1. Respect single-flight cooldown (a sibling request hit a 429).
    await this.waitForCooldown();

    // 2. Take a request slot (caps raw request concurrency as a backstop).
    const releaseSlot = await this.requestSlots.acquire();

    // 3. Reserve token budget; block until enough is free.
    await this.reserveTokens(want);

    const estimated = want;
    let released = false;
    return async (info?: ReleaseInfo) => {
      if (released) return; // idempotent
      released = true;
      await this.release(estimated, releaseSlot, info);
    };
  }

  /** Inform the limiter of a request's outcome. Drives the whole AIMD loop. */
  async release(estimated: number, releaseSlot: () => void, info?: ReleaseInfo): Promise<void> {
    // Always free the request slot + token reservation, even if learning throws.
    const actual = info?.actualTokens ?? estimated;
    try {
      this.inflightTokens = Math.max(0, this.inflightTokens - estimated);
    } finally {
      releaseSlot();
    }

    if (info) {
      await this.learn(info, actual);
    } else {
      // No info = success with unknown token count. Count as a benign success
      // so slow-start can still progress on providers that don't return usage.
      this.recordSuccess(actual);
    }
    await this.maybePersist();
  }

  // ── budget accounting ────────────────────────────────────────────────────

  /** Max time a single acquire will wait for budget before failing open.
   *  Prevents an infinite stall if budget accounting ever wedges (e.g. a
   *  release that never fired). Failing open is safer than blocking the
   *  pipeline forever — a stray 429 is recoverable, a deadlocked worker isn't. */
  private static readonly ACQUIRE_TIMEOUT_MS = 5 * 60_000;

  private async reserveTokens(want: number): Promise<void> {
    // If THIS single request already exceeds the entire budget, blocking is
    // pointless — the request is atomic (can't be split to fit under budget),
    // so waiting would just deadlock until the fail-open timeout. A single big
    // request (e.g. an embedding batch of 4 chunks joined into one API call) is
    // not a concurrency hazard on its own; it's only a problem when MANY such
    // requests pile up. We let it through immediately and rely on the AIMD loop
    // to grow the budget on success (so subsequent batches stop hitting this).
    if (want >= this.budgetTokens) {
      const release = await this.budgetLock.acquire();
      try {
        this.inflightTokens += want;
      } finally {
        release();
      }
      return;
    }

    // Spin-wait until inflight + want <= budget. A semaphore can't represent
    // a *variable* permit count, so we poll. The poll yields to the event loop
    // each iteration (await delay) so a release on another tick can free budget.
    const deadline = Date.now() + AdaptiveLimiter.ACQUIRE_TIMEOUT_MS;
    for (;;) {
      const release = await this.budgetLock.acquire();
      try {
        if (this.inflightTokens + want <= this.budgetTokens) {
          this.inflightTokens += want;
          return;
        }
      } finally {
        release();
      }
      if (Date.now() >= deadline) {
        // Fail open: proceed without the reservation rather than deadlock the
        // caller. The provider's own 429 will catch a true over-send.
        return;
      }
      await delay(10);
    }
  }

  private signalSlotFreed(): void {
    // Wake any budget-waiter by virtue of the next poll iteration. Nothing
    // extra to do — reserveTokens polls on its own timer.
  }

  private async waitForCooldown(): Promise<void> {
    const now = Date.now();
    const remaining = this.cooldownUntil - now;
    if (remaining > 0) {
      await delay(remaining);
    }
  }

  // ── the learning loop ────────────────────────────────────────────────────

  private async learn(info: ReleaseInfo, actualTokens: number): Promise<void> {
    // 1. Latency gradient (lossless early signal) — sample BEFORE deciding.
    if (info.latencyMs !== undefined) {
      this.sampleLatency(info.latencyMs);
    }

    // 2. Rate-limit headers → feed-forward. If the provider tells us the
    //    ceiling directly, trust it and set budget accordingly. This is the
    //    zero-429 path.
    if (info.rateLimit) {
      this.applyRateLimitHeaders(info.rateLimit);
    }

    // 3. Outcome-based AIMD.
    if (info.status === 429 || info.status === 503) {
      await this.onRateLimited(info);
    } else if (info.status >= 200 && info.status < 300) {
      this.recordSuccess(actualTokens);
    }
    // 4xx (non-429) / other 5xx: don't reward or punish — they're not signals
    // about capacity (auth errors, model-not-found, etc.).
  }

  private recordSuccess(actualTokens: number): void {
    this.consecutiveSuccesses += 1;

    // Update ceiling: a successful request at this inflight level proves the
    // current budget is sustainable. Drift ceiling up toward current budget.
    if (this.budgetTokens > this.ceilingTokens) {
      this.ceilingTokens = Math.min(this.budgetTokens, CEILING_CAP_TOKENS);
    }

    if (this.phase === "slow-start") {
      if (this.consecutiveSuccesses >= SLOW_START_SUCCESSES) {
        this.consecutiveSuccesses = 0;
        // Double the budget (slow-start). Cap at CEILING_CAP.
        this.budgetTokens = Math.min(this.budgetTokens * 2, CEILING_CAP_TOKENS);
      }
    } else if (this.phase === "additive") {
      if (this.consecutiveSuccesses >= AI_SUCCESSES) {
        this.consecutiveSuccesses = 0;
        this.budgetTokens = Math.min(this.budgetTokens + AI_STEP_TOKENS, CEILING_CAP_TOKENS);
      }
    }
    // In cooldown: success doesn't grow budget (we're still backing off).
  }

  /** Latency gradient: P95 climbing above baseline × threshold → gentle MD. */
  private sampleLatency(latencyMs: number): void {
    // EWMA with α=0.2 — smooths jitter, tracks drift over ~10 samples.
    this.latencyEwma = this.latencyEwma === 0
      ? latencyMs
      : this.latencyEwma * 0.8 + latencyMs * 0.2;
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > 20) this.latencySamples.shift();

    if (this.latencySamples.length < 8) return; // not enough data yet
    const baseline = this.latencyEwma;
    if (baseline <= 0) return;
    const p95 = percentile(this.latencySamples, 0.95);
    if (p95 > baseline * LATENCY_THRESHOLD && this.phase !== "cooldown") {
      // Provider is queuing — back off gently BEFORE a 429.
      this.budgetTokens = Math.max(FLOOR_TOKENS, Math.round(this.budgetTokens * LATENCY_FACTOR));
      this.phase = "additive"; // re-probe additively, not slow-start
      // Don't reset ceiling here — latency is a soft signal.
    }
  }

  private applyRateLimitHeaders(info: RateLimitInfo): void {
    // If the provider reports a token limit, calibrate budget to it directly
    // (× headroom). This is the authoritative ceiling — no need to probe.
    if (info.limitTokens !== undefined && info.limitTokens > 0) {
      const target = Math.round(info.limitTokens * HEADROOM);
      if (target > this.ceilingTokens) {
        this.ceilingTokens = Math.min(target, CEILING_CAP_TOKENS);
      }
      // Adopt the limit as the budget if we're below it (we were under-utilising).
      if (this.budgetTokens < target) {
        this.budgetTokens = target;
        this.phase = "additive";
      }
    } else if (info.limitRequests !== undefined && info.limitRequests > 0) {
      // No token limit but a request limit — translate loosely (request × avg
      // request size). Conservative: assume each request ≈ AI_STEP_TOKENS.
      const implied = info.limitRequests * AI_STEP_TOKENS;
      if (implied > this.ceilingTokens) {
        this.ceilingTokens = Math.min(implied, CEILING_CAP_TOKENS);
      }
    }

    // If remaining is low, proactively shrink so we don't blow through it.
    if (info.remainingTokens !== undefined && info.remainingTokens < this.budgetTokens) {
      this.budgetTokens = Math.max(FLOOR_TOKENS, info.remainingTokens);
    }
  }

  /**
   * Public hook for adapters to report a 429/503 THE INSTANT it happens —
   * before their own retry loop exhausts. This triggers single-flight cooldown
   * immediately so sibling in-flight requests stop hitting the provider too
   * (the anti-thundering-herd / anti-ban measure), rather than waiting for
   * the failing request to fully release.
   *
   * Idempotent within a cooldown window: if a recent 429 already shrank the
   * budget + started cooldown, a second call from the same incident (e.g. the
   * request's eventual release) only refreshes the cooldown, never double-MDs.
   * This is why `release()` calling learn()→onRateLimited after an adapter
   * already called notifyRateLimited() is safe.
   */
  async notifyRateLimited(rateLimit?: RateLimitInfo): Promise<void> {
    const now = Date.now();
    const alreadyInCooldown = now < this.cooldownUntil;

    this.consecutiveSuccesses = 0;

    // Multiplicative decrease — but only once per cooldown window, so the
    // adapter's mid-retry notify + the eventual release don't both shrink.
    if (!alreadyInCooldown) {
      this.budgetTokens = Math.max(FLOOR_TOKENS, Math.round(this.budgetTokens * MD_FACTOR));
    }

    // single-flight cooldown: freeze ALL acquires for this provider.
    const retryMs = rateLimit?.retryAfterMs ?? 0;
    const cooldownMs = retryMs > 0 ? retryMs : backoffFromBudget(this.budgetTokens);
    // Extend (don't shorten) an existing cooldown if the new hint is longer.
    const proposedEnd = now + cooldownMs;
    if (proposedEnd > this.cooldownUntil) {
      this.cooldownUntil = proposedEnd;
    }
    this.phase = "cooldown";

    // Persist immediately — a 429 is precious calibration data.
    await this.persist();
  }

  /** A 429/503 happened — delegates to notifyRateLimited (release path). */
  private async onRateLimited(info: ReleaseInfo): Promise<void> {
    // The adapter may have already called notifyRateLimited() when it first saw
    // the 429 mid-retry. notifyRateLimited is idempotent within the cooldown
    // window, so this is safe (no double MD).
    await this.notifyRateLimited(info.rateLimit);
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private async maybePersist(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPersistAt < PERSIST_INTERVAL_MS) return;
    if (Math.abs(this.budgetTokens - this.lastPersistedBudget) < AI_STEP_TOKENS) return;
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.lastPersistAt = Date.now();
    this.lastPersistedBudget = this.budgetTokens;
    try {
      await updateCapacity(this.providerKey, {
        budgetTokens: this.budgetTokens,
        discoveredCeiling: this.ceilingTokens,
        discoveredFloor: FLOOR_TOKENS,
        emitsRateLimitHeaders: false, // set more precisely by the adapter if known
        last429At: this.phase === "cooldown" ? Date.now() : null,
      });
    } catch (err) {
      // Persistence is best-effort — never fail a request because the stats
      // file couldn't be written.
      console.warn(`[limiter] failed to persist capacity for ${this.providerKey}:`, err);
    }
  }

  // ── introspection (tests / observability) ────────────────────────────────

  get currentBudget(): number { return this.budgetTokens; }
  get currentCeiling(): number { return this.ceilingTokens; }
  get inflight(): number { return this.inflightTokens; }
  get currentPhase(): Phase { return this.phase; }
  get cooldownRemainingMs(): number { return Math.max(0, this.cooldownUntil - Date.now()); }
}

// ── process-global registry: one limiter per provider ───────────────────────

const limiters = new Map<string, AdaptiveLimiter>();

/** Disable switch (LLM_LIMITER_ENABLED=false) — falls back to no limiting. */
const LIMITER_ENABLED = process.env.LLM_LIMITER_ENABLED !== "false";

/**
 * Get (or lazily create) the shared limiter for a provider. Bootstraps the
 * budget from persisted capacity if present, so we start near the known
 * ceiling instead of probing from floor every restart.
 */
export async function getLimiter(providerKey: string): Promise<AdaptiveLimiter | null> {
  if (!LIMITER_ENABLED) return null;
  const existing = limiters.get(providerKey);
  if (existing) return existing;

  // Bootstrap from persisted record (the "paid-once tuition").
  let initialBudget = FLOOR_TOKENS;
  let initialCeiling = FLOOR_TOKENS;
  try {
    const rec = await readCapacity(providerKey);
    if (rec) {
      // Start at discovered ceiling × headroom — we've probed before.
      initialCeiling = rec.discoveredCeiling || FLOOR_TOKENS;
      initialBudget = Math.max(FLOOR_TOKENS, Math.round(initialCeiling * HEADROOM));
    }
  } catch {
    // corrupt/missing record → start from floor (will slow-start).
  }

  const limiter = new AdaptiveLimiter(providerKey, {
    initialBudget,
    initialCeiling,
  });
  limiters.set(providerKey, limiter);
  return limiter;
}

/** Test helper: clear the registry + force re-creation from store. */
export function _resetLimiterRegistryForTests(): void {
  limiters.clear();
}

// ── small utils ─────────────────────────────────────────────────────────────

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? 0;
}

/** A light backoff when the server gave no Retry-After. Scales with how much
 *  headroom we still have — at floor we wait longer (we're really constrained). */
function backoffFromBudget(budgetTokens: number): number {
  const atFloor = budgetTokens <= FLOOR_TOKENS;
  // 2s normally, up to 30s when pinned at the floor.
  return atFloor ? 30_000 : 2_000;
}
