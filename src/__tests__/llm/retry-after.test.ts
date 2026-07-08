import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseRetryAfterMs, computeBackoffMs, isBalanceExhausted } from "@/lib/llm/retry-after";

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds form", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("120")).toBe(120_000);
    expect(parseRetryAfterMs("5")).toBe(5_000);
  });

  it("clamps absurdly large delta-seconds to the 5min ceiling", () => {
    expect(parseRetryAfterMs("3600")).toBe(5 * 60 * 1000);
    expect(parseRetryAfterMs("9999999")).toBe(5 * 60 * 1000);
  });

  it("parses HTTP-date form relative to now", () => {
    const futureMs = Date.now() + 30_000;
    const header = new Date(futureMs).toUTCString();
    const parsed = parseRetryAfterMs(header);
    expect(parsed).not.toBeNull();
    // Allow generous slack for test timing + Date.parse rounding.
    expect(parsed!).toBeGreaterThan(20_000);
    expect(parsed!).toBeLessThan(40_000);
  });

  it("clamps a past HTTP-date to 0", () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
  });

  it("returns null for absent / malformed values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("   ")).toBeNull();
    expect(parseRetryAfterMs("not a date or number")).toBeNull();
    expect(parseRetryAfterMs("1.5s")).toBeNull();
    expect(parseRetryAfterMs("-10")).toBeNull();
  });
});

describe("computeBackoffMs", () => {
  beforeEach(() => {
    // Pin Math.random so jitter is deterministic: Math.random() → 0.5 means
    // offset = 0 (midpoint of ±25%), so the result equals the base exactly.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("honours Retry-After seconds when present", () => {
    // 0.5 jitter → no offset → exact server value.
    expect(computeBackoffMs("10", 3)).toBe(10_000);
    expect(computeBackoffMs("120", 2)).toBe(120_000);
  });

  it("honours Retry-After HTTP-date when present", () => {
    const futureMs = Date.now() + 20_000;
    const header = new Date(futureMs).toUTCString();
    const result = computeBackoffMs(header, 3);
    expect(result).toBeGreaterThan(12_000);
    expect(result).toBeLessThan(28_000);
  });

  it("falls back to exponential when Retry-After is absent", () => {
    // attemptRemaining 3 → 2^(4-3) = 2s, 2 → 4s, 1 → 8s (pinned jitter = exact).
    expect(computeBackoffMs(null, 3)).toBe(2_000);
    expect(computeBackoffMs(null, 2)).toBe(4_000);
    expect(computeBackoffMs(null, 1)).toBe(8_000);
  });

  it("falls back when Retry-After is malformed", () => {
    expect(computeBackoffMs("garbage", 3)).toBe(2_000);
  });

  it("clamps exponential fallback to the 5min ceiling", () => {
    // attemptRemaining is clamped to [1,3] so the max base is 8s — but guard
    // that an out-of-range attemptRemaining can't blow past the ceiling.
    expect(computeBackoffMs(null, 0)).toBe(8_000);
    expect(computeBackoffMs(null, -5)).toBe(8_000);
  });

  it("applies ±25% jitter around the base", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // → offset = -25%
    expect(computeBackoffMs(null, 3)).toBe(1_500); // 2000 × 0.75

    vi.spyOn(Math, "random").mockReturnValue(1); // → offset = +25%
    expect(computeBackoffMs(null, 3)).toBe(2_500); // 2000 × 1.25
  });

  it("never returns a negative delay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(computeBackoffMs("0", 3)).toBe(0);
    expect(computeBackoffMs(null, 3)).toBeGreaterThanOrEqual(0);
  });
});

describe("computeBackoffMs / parseRetryAfterMs — capacityMode", () => {
  beforeEach(() => {
    // Deterministic jitter (Math.random() → 0.5 → no offset).
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("capacityMode honours a long Retry-After instead of clamping to 5min", () => {
    // "18000" seconds = 5h. Without capacityMode this clamps to 5min.
    // With capacityMode it should honour the full 5h (18_000_000 ms).
    expect(parseRetryAfterMs("18000", { capacityMode: true })).toBe(18_000_000);
    expect(computeBackoffMs("18000", 3, Date.now(), { capacityMode: true })).toBe(18_000_000);
  });

  it("capacityMode honours a 1-hour Retry-After", () => {
    // 3600s = 1h = 3_600_000 ms. Default mode clamps to 5min (300_000).
    expect(parseRetryAfterMs("3600")).toBe(300_000); // default clamps
    expect(parseRetryAfterMs("3600", { capacityMode: true })).toBe(3_600_000);
  });

  it("capacityMode still clamps at the 6h ceiling", () => {
    // 100000s ≈ 27.7h — even capacityMode shouldn't wait forever.
    const result = parseRetryAfterMs("100000", { capacityMode: true });
    expect(result).toBe(6 * 60 * 60 * 1000); // 6h cap
  });

  it("default mode unchanged for small values", () => {
    // capacityMode must not change behaviour for sub-ceiling values.
    expect(parseRetryAfterMs("120")).toBe(120_000);
    expect(parseRetryAfterMs("120", { capacityMode: true })).toBe(120_000);
  });
});

describe("isBalanceExhausted", () => {
  it("detects OpenAI insufficient_quota on 429", () => {
    expect(isBalanceExhausted(429, '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}')).toBe(true);
  });

  it("detects HTTP 402 Payment Required", () => {
    expect(isBalanceExhausted(402, "payment required")).toBe(true);
    expect(isBalanceExhausted(402, '{"error":"billing: payment_required"}')).toBe(true);
  });

  it("detects Chinese providers' 余额不足 / 充值 markers", () => {
    expect(isBalanceExhausted(429, '{"error":{"message":"余额不足，请充值"}}')).toBe(true);
    expect(isBalanceExhausted(429, "account balance is zero, please top up")).toBe(true);
  });

  it("detects credit / billing markers", () => {
    expect(isBalanceExhausted(429, "no enough balance")).toBe(true);
    expect(isBalanceExhausted(403, '{"error":"credit exhausted"}')).toBe(true);
  });

  it("does NOT match ordinary rate-limit 429s (no billing markers)", () => {
    // A plain rate-limit must still retry — only billing failures short-circuit.
    expect(isBalanceExhausted(429, '{"error":{"code":"rate_limit_exceeded"}}')).toBe(false);
    expect(isBalanceExhausted(429, "Too Many Requests")).toBe(false);
    expect(isBalanceExhausted(429, "server overloaded")).toBe(false);
    expect(isBalanceExhausted(503, "service unavailable")).toBe(false);
  });

  it("does NOT match non-billing statuses", () => {
    expect(isBalanceExhausted(400, "insufficient_quota")).toBe(false);
    expect(isBalanceExhausted(500, "billing error")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isBalanceExhausted(429, "INSUFFICIENT_QUOTA")).toBe(true);
    expect(isBalanceExhausted(429, "Balance Is Zero")).toBe(true);
  });
});
