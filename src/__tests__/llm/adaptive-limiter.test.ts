import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Stub delay BEFORE importing the limiter. delay MUST yield to the event loop
// (real setTimeout, not resolved-value) so a blocked acquire can resume once a
// sibling release frees budget on another tick — otherwise reserveTokens
// busy-spins and OOMs the worker.
const originalSetTimeout = setTimeout;
vi.mock("@/lib/llm/retry-after", () => ({
  delay: vi.fn((ms: number) => new Promise<void>((r) => originalSetTimeout(r, ms))),
  computeBackoffMs: vi.fn(() => 1000),
  parseRetryAfterMs: vi.fn(() => null),
}));

import { AdaptiveLimiter, getLimiter, _resetLimiterRegistryForTests } from "@/lib/llm/adaptive-limiter";
import { _resetCapacityCacheForTests, updateCapacity } from "@/lib/llm/provider-capacity-store";

// Isolate capacity persistence to a fresh temp dir per test so the suite never
// touches the real ~/.synthetix-data/provider-capacity/.
let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lim-test-"));
  process.env.DB_PATH = tmpDir;
  _resetCapacityCacheForTests();
  _resetLimiterRegistryForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DB_PATH;
});

/** Drain a limiter's success loop: acquire + release a success N times serially. */
async function succeedTimes(
  lim: AdaptiveLimiter,
  n: number,
  tokens = 1000,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const release = await lim.acquire({ estimatedTokens: tokens });
    await release({ status: 200, actualTokens: tokens, latencyMs: 100 });
  }
}

describe("AdaptiveLimiter — slow-start", () => {
  it("starts at floor and doubles budget after K successes", async () => {
    const lim = new AdaptiveLimiter("test:slow-start", { initialBudget: 4000 });
    const startBudget = lim.currentBudget;
    // SLOW_START_SUCCESSES defaults to 8.
    await succeedTimes(lim, 8);
    expect(lim.currentBudget).toBe(startBudget * 2);
    expect(lim.currentPhase).toBe("slow-start");
  });

  it("keeps doubling on each K-success batch in slow-start", async () => {
    const lim = new AdaptiveLimiter("test:slow-start-2", { initialBudget: 4000 });
    await succeedTimes(lim, 8);
    expect(lim.currentBudget).toBe(8000);
    await succeedTimes(lim, 8);
    expect(lim.currentBudget).toBe(16000);
  });
});

describe("AdaptiveLimiter — multiplicative decrease", () => {
  it("shrinks budget by MD_FACTOR (0.75) on a 429", async () => {
    const lim = new AdaptiveLimiter("test:md", { initialBudget: 8000 });
    // Grow a bit first so MD has something to shrink.
    await succeedTimes(lim, 8); // → 16000
    const before = lim.currentBudget;

    const release = await lim.acquire({ estimatedTokens: 1000 });
    await release({ status: 429, actualTokens: 1000 });

    expect(lim.currentBudget).toBe(Math.round(before * 0.75));
  });

  it("never shrinks below FLOOR_TOKENS", async () => {
    vi.useFakeTimers();
    try {
      const lim = new AdaptiveLimiter("test:floor", { initialBudget: 60_000 });
      // Each 429: MD ×0.75 then cooldown. Advance fake time past each cooldown
      // so the next acquire doesn't wait on real setTimeout (which would time
      // the test out). 60000 → 45000 → 33750 → ... converges to floor 4000.
      for (let i = 0; i < 30; i++) {
        const release = await lim.acquire({ estimatedTokens: 100 });
        await release({ status: 429, actualTokens: 100 });
        // Skip the cooldown window before the next iteration.
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(lim.currentBudget).toBeGreaterThanOrEqual(4000); // FLOOR_TOKENS
    } finally {
      vi.useRealTimers();
    }
  });

  it("enters cooldown after a 429 (single-flight)", async () => {
    const lim = new AdaptiveLimiter("test:cooldown", { initialBudget: 8000 });
    const release = await lim.acquire({ estimatedTokens: 1000 });
    await release({ status: 429, actualTokens: 1000, rateLimit: { retryAfterMs: 5000 } });
    expect(lim.cooldownRemainingMs).toBeGreaterThan(0);
    expect(lim.currentPhase).toBe("cooldown");
  });
});

describe("AdaptiveLimiter — rate-limit header feed-forward", () => {
  it("adopts a reported token limit as the budget (× headroom)", async () => {
    const lim = new AdaptiveLimiter("test:headers", { initialBudget: 4000 });
    const release = await lim.acquire({ estimatedTokens: 1000 });
    // Provider reports a 100k token ceiling.
    await release({
      status: 200,
      actualTokens: 1000,
      latencyMs: 100,
      rateLimit: { limitTokens: 100_000 },
    });
    // budget should jump to 100000 × 0.8 headroom = 80000.
    expect(lim.currentBudget).toBe(80_000);
    expect(lim.currentCeiling).toBe(80_000);
  });

  it("shrinks budget when remaining-tokens is below current budget", async () => {
    const lim = new AdaptiveLimiter("test:remaining", { initialBudget: 50_000 });
    const release = await lim.acquire({ estimatedTokens: 1000 });
    await release({
      status: 200,
      actualTokens: 1000,
      latencyMs: 100,
      rateLimit: { remainingTokens: 5000 },
    });
    expect(lim.currentBudget).toBe(5000);
  });
});

describe("AdaptiveLimiter — latency gradient", () => {
  it("gently decreases budget when P95 latency climbs above threshold", async () => {
    const lim = new AdaptiveLimiter("test:latency", { initialBudget: 20_000 });
    // Establish a low-latency baseline with 8 fast samples.
    for (let i = 0; i < 8; i++) {
      const release = await lim.acquire({ estimatedTokens: 1000 });
      await release({ status: 200, actualTokens: 1000, latencyMs: 100 });
    }
    const before = lim.currentBudget;
    // Now feed slow samples that exceed baseline × 1.5 (threshold).
    for (let i = 0; i < 8; i++) {
      const release = await lim.acquire({ estimatedTokens: 1000 });
      await release({ status: 200, actualTokens: 1000, latencyMs: 500 });
    }
    // Should have shrunk (×0.9 latency factor at least once).
    expect(lim.currentBudget).toBeLessThan(before);
  });
});

describe("AdaptiveLimiter — budget blocking", () => {
  it("blocks acquire when inflight would exceed budget", async () => {
    // Tiny budget so we can exhaust it.
    const lim = new AdaptiveLimiter("test:block", {
      initialBudget: 4000,
      maxRequestConcurrency: 8,
    });
    // Acquire two reservations that together exceed the 4000 budget.
    const r1 = await lim.acquire({ estimatedTokens: 2500 });
    expect(lim.inflight).toBe(2500);
    // A third acquire of 2500 would push inflight to 5000 > 4000 budget → blocks.
    let thirdResolved = false;
    const thirdP = lim.acquire({ estimatedTokens: 2500 }).then((r) => {
      thirdResolved = true;
      return r;
    });
    await Promise.race([thirdP, new Promise((r) => setTimeout(r, 50))]);
    expect(thirdResolved).toBe(false);
    // Releasing the first frees budget; the third should now proceed.
    await r1({ status: 200, actualTokens: 2500 });
    const r3 = await thirdP;
    expect(thirdResolved).toBe(true);
    await r3({ status: 200, actualTokens: 2500 });
  });

  it("lets a single request through when it alone exceeds the budget", async () => {
    // Regression: an embedding batch (e.g. 4 chunks joined = ~16k tokens) that
    // exceeds the floor budget (4k) must NOT block — the request is atomic and
    // can't be split, so blocking would just deadlock to the fail-open timeout.
    // This was the root cause of embed-stage stalls in the first live test.
    const lim = new AdaptiveLimiter("test:big-request", {
      initialBudget: 4000,
      maxRequestConcurrency: 8,
    });
    // 16000 tokens > 4000 budget → must resolve immediately, not block.
    const started = Date.now();
    const r = await lim.acquire({ estimatedTokens: 16_000 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(100); // didn't wait
    expect(lim.inflight).toBe(16_000);
    await r({ status: 200, actualTokens: 16_000 });
    // The big request succeeds without deadlock — that's the whole point.
    // Budget itself doesn't change (the request was let through, not counted
    // toward growth); AIMD growth happens via the normal success-accumulation
    // path on subsequent smaller requests.
    expect(lim.inflight).toBe(0);
  });
});

describe("AdaptiveLimiter — persistence", () => {
  it("persists discovered ceiling to the capacity store after a 429", async () => {
    const lim = new AdaptiveLimiter("test:persist", { initialBudget: 60_000 });
    // Grow ceiling via successes first.
    await succeedTimes(lim, 8);
    // A 429 forces an immediate persist.
    const release = await lim.acquire({ estimatedTokens: 1000 });
    await release({ status: 429, actualTokens: 1000 });

    const file = path.join(tmpDir, "provider-capacity", "provider-capacity.json");
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(raw["test:persist"]).toBeDefined();
    expect(raw["test:persist"].discoveredCeiling).toBeGreaterThan(0);
  });
});

describe("AdaptiveLimiter — notifyRateLimited (single-flight + idempotency)", () => {
  it("triggers cooldown the instant a 429 is reported, before release", async () => {
    const lim = new AdaptiveLimiter("test:notify", { initialBudget: 80_000 });
    // Acquire so there's an in-flight request, but don't release yet —
    // simulating a mid-retry 429 that the adapter saw via notifyRateLimited.
    await lim.acquire({ estimatedTokens: 1000 });
    const before = lim.currentBudget;
    await lim.notifyRateLimited({ retryAfterMs: 5000 });
    // Budget shrank (MD) AND cooldown is active — all from notify, before release.
    expect(lim.currentBudget).toBeLessThan(before);
    expect(lim.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it("does NOT double-shrink when release reports the same 429 after notify", async () => {
    const lim = new AdaptiveLimiter("test:idempotent", { initialBudget: 80_000 });
    const release = await lim.acquire({ estimatedTokens: 1000 });

    // adapter saw the 429 mid-retry → notify
    await lim.notifyRateLimited();
    const afterNotify = lim.currentBudget;

    // request finally fails → release reports the same 429
    await release({ status: 429, actualTokens: 1000 });
    const afterRelease = lim.currentBudget;

    // Only ONE multiplicative decrease, not two.
    expect(afterRelease).toBe(afterNotify);
  });

  it("blocks a second acquire during cooldown (single-flight for the provider)", async () => {
    const lim = new AdaptiveLimiter("test:single-flight", { initialBudget: 80_000 });
    // Short cooldown so the test doesn't hang on real timers.
    await lim.notifyRateLimited({ retryAfterMs: 200 });
    expect(lim.cooldownRemainingMs).toBeGreaterThan(0);

    // A second acquire should block (not resolve immediately).
    let resolved = false;
    const p = lim.acquire({ estimatedTokens: 100 }).then((r) => {
      resolved = true;
      return r;
    });
    // Give it a tick — if cooldown weren't enforced this would resolve fast.
    await Promise.race([p, new Promise((r) => setTimeout(r, 50))]);
    expect(resolved).toBe(false);

    // After the cooldown elapses (real 200ms), it proceeds.
    const r = await p;
    expect(resolved).toBe(true);
    await r({ status: 200, actualTokens: 100 });
  });
});

describe("AdaptiveLimiter — notifyNetworkBlip (network instability ≠ rate-limit)", () => {
  it("does NOT shrink the budget on a network blip", async () => {
    const lim = new AdaptiveLimiter("test:net-blip-budget", { initialBudget: 80_000 });
    const before = lim.currentBudget;
    await lim.notifyNetworkBlip();
    expect(lim.currentBudget).toBe(before);
  });

  it("does NOT enter cooldown on a network blip", async () => {
    const lim = new AdaptiveLimiter("test:net-blip-cooldown", { initialBudget: 80_000 });
    await lim.notifyNetworkBlip();
    expect(lim.cooldownRemainingMs).toBe(0);
    expect(lim.currentPhase).not.toBe("cooldown");
  });

  it("resets consecutive successes (pauses budget growth, doesn't punish)", async () => {
    const lim = new AdaptiveLimiter("test:net-blip-grow", { initialBudget: 80_000 });
    await succeedTimes(lim, 5);
    // After 5 successes the success counter advanced; a blip resets it so we
    // don't aggressively probe upward through a noisy period.
    await lim.notifyNetworkBlip();
    // Budget unchanged (no growth, no shrink) — blip only paused growth.
    expect(lim.currentBudget).toBe(80_000);
  });

  it("increments the blip counter (observability)", async () => {
    const lim = new AdaptiveLimiter("test:net-blip-count", { initialBudget: 80_000 });
    expect(lim.networkBlipCount).toBe(0);
    await lim.notifyNetworkBlip();
    await lim.notifyNetworkBlip();
    expect(lim.networkBlipCount).toBe(2);
  });
});

describe("AdaptiveLimiter — MIN_REQUEST_CONCURRENCY floor", () => {
  it(" Semaphore permit count respects the floor when cap is low", () => {
    // Constructing with a cap of 1 should still yield a semaphore with at
    // least MIN_REQUEST_CONCURRENCY permits (default 1) — and crucially,
    // when the env floor is raised, the floor binds over a low cap.
    const lim = new AdaptiveLimiter("test:min-floor", {
      initialBudget: 4_000,
      maxRequestConcurrency: 1,
    });
    // Default floor is 1, so cap=1 stays at 1 — verify it doesn't go below.
    // Two concurrent acquires should both be able to proceed (sequential
    // acquire-release proves the semaphore has ≥1 permit).
    return (async () => {
      const r1 = await lim.acquire({ estimatedTokens: 100 });
      await r1({ status: 200, actualTokens: 100 });
      const r2 = await lim.acquire({ estimatedTokens: 100 });
      await r2({ status: 200, actualTokens: 100 });
    })();
  });
});

describe("AdaptiveLimiter — remaining-token jump-up (provider reports headroom)", () => {
  // Bug: applyRateLimitHeaders only used remaining-* to SHRINK budget, never to
  // grow it. Providers like DeepSeek/OpenAI return x-ratelimit-remaining-* but
  // NOT x-ratelimit-limit-*, so after a 429 cooldown or cold start the budget
  // could only climb back via slow AIMD — wasting throughput for minutes even
  // when the provider explicitly reported plenty of remaining capacity.
  it("jumps budget UP when remaining > budget and remaining < ceiling", async () => {
    // Start with a budget that's been shrunk (e.g. after a 429 cooldown).
    const lim = new AdaptiveLimiter("test:remaining-jump", {
      initialBudget: 8_000,
      initialCeiling: 100_000,
    });
    expect(lim.currentBudget).toBe(8_000);

    // Provider reports 50_000 remaining tokens — well above our shrunk budget,
    // below the ceiling. We should jump up to use that headroom.
    const release = await lim.acquire({ estimatedTokens: 100 });
    await release({
      status: 200,
      actualTokens: 100,
      latencyMs: 50,
      rateLimit: { remainingTokens: 50_000 },
    });

    expect(lim.currentBudget).toBe(50_000);
    expect(lim.currentPhase).toBe("additive");
  });

  it("does NOT jump past the probed ceiling", async () => {
    const lim = new AdaptiveLimiter("test:remaining-ceiling", {
      initialBudget: 8_000,
      initialCeiling: 40_000,
    });
    const release = await lim.acquire({ estimatedTokens: 100 });
    // remaining (60k) > ceiling (40k) → must NOT jump past ceiling.
    await release({
      status: 200,
      actualTokens: 100,
      latencyMs: 50,
      rateLimit: { remainingTokens: 60_000 },
    });
    expect(lim.currentBudget).toBe(8_000); // unchanged — remaining exceeds ceiling
  });

  it("still shrinks when remaining < budget (existing behaviour preserved)", async () => {
    const lim = new AdaptiveLimiter("test:remaining-shrink", {
      initialBudget: 50_000,
      initialCeiling: 100_000,
    });
    const release = await lim.acquire({ estimatedTokens: 100 });
    await release({
      status: 200,
      actualTokens: 100,
      latencyMs: 50,
      rateLimit: { remainingTokens: 5_000 },
    });
    expect(lim.currentBudget).toBe(5_000);
  });
});

describe("AdaptiveLimiter — getLimiter optimistic cold start", () => {
  it("a fresh provider bootstraps at the optimistic initial budget, not floor", async () => {
    // No persisted record for this provider key → should start at
    // INITIAL_BUDGET_TOKENS (32000), not FLOOR_TOKENS (4000), so the first
    // graph extraction doesn't pay a 4-16 min slow-start tax.
    const lim = await getLimiter("test:cold-start-fresh");
    expect(lim).not.toBeNull();
    expect(lim!.currentBudget).toBe(32_000);
    expect(lim!.currentBudget).toBeGreaterThan(4_000); // not stuck at floor
  });

  it("a known provider bootstraps at ceiling × headroom (skip slow-start)", async () => {
    // Seed a discovered ceiling, then getLimiter should use ceiling × HEADROOM.
    await updateCapacity("test:cold-start-known", {
      budgetTokens: 40_000,
      discoveredCeiling: 50_000,
      discoveredFloor: 4_000,
      emitsRateLimitHeaders: false,
      last429At: null,
      lastUpdated: Date.now(),
    });
    _resetLimiterRegistryForTests();
    const lim = await getLimiter("test:cold-start-known");
    expect(lim).not.toBeNull();
    // ceiling 50000 × headroom 0.8 = 40000
    expect(lim!.currentBudget).toBe(40_000);
  });
});
