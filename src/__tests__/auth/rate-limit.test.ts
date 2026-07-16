import { afterEach, describe, expect, it } from "vitest";
import {
  createRateLimiter,
  getClientIp,
  normalizeUsername,
  resetRateLimitsForTest,
} from "@/lib/auth/rate-limit";

describe("auth rate limiter", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY_HOPS;
    resetRateLimitsForTest();
  });

  it("blocks after the configured number of failures without real delays", () => {
    let now = 1_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, clock: () => now });

    expect(limiter.check("account").allowed).toBe(true);
    limiter.recordFailure("account");
    expect(limiter.check("account").allowed).toBe(true);
    limiter.recordFailure("account");

    const blocked = limiter.check("account");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);

    now += 60_000;
    expect(limiter.check("account").allowed).toBe(true);
  });

  it("clears successful keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, clock: () => 1_000 });
    limiter.recordFailure("account");
    expect(limiter.check("account").allowed).toBe(false);

    limiter.clear("account");
    expect(limiter.check("account").allowed).toBe(true);
  });

  it("normalizes usernames for stable account keys", () => {
    expect(normalizeUsername("  Admin@Example.COM  ")).toBe("admin@example.com");
  });

  it("does not trust forwarded IP headers by default", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2" },
    });

    expect(getClientIp(request)).toBe("direct");
  });

  it("uses the configured proxy hop count when resolving forwarded IPs", () => {
    process.env.TRUST_PROXY_HOPS = "1";
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2" },
    });

    expect(getClientIp(request)).toBe("203.0.113.10");
  });

  it("treats TRUST_PROXY_HOPS=true as one trusted proxy hop", () => {
    process.env.TRUST_PROXY_HOPS = "true";
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    expect(getClientIp(request)).toBe("203.0.113.10");
  });
});
