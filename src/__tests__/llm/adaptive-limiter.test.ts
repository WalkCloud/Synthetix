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

import { AdaptiveLimiter, _resetLimiterRegistryForTests } from "@/lib/llm/adaptive-limiter";
import { _resetCapacityCacheForTests } from "@/lib/llm/provider-capacity-store";

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
