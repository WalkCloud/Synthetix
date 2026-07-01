import { describe, it, expect } from "vitest";
import { parseRateLimitHeaders, hasRateLimitSignal } from "@/lib/llm/rate-limit-headers";

function headers(obj: Record<string, string>): Headers {
  return new Headers(obj);
}

describe("parseRateLimitHeaders", () => {
  it("parses OpenAI-style headers", () => {
    const info = parseRateLimitHeaders(
      headers({
        "x-ratelimit-remaining-requests": "47",
        "x-ratelimit-remaining-tokens": "83000",
        "x-ratelimit-limit-requests": "60",
        "x-ratelimit-limit-tokens": "90000",
        "x-ratelimit-reset-requests": "1.2s",
        "retry-after": "3",
      }),
    );
    expect(info.remainingRequests).toBe(47);
    expect(info.remainingTokens).toBe(83000);
    expect(info.limitRequests).toBe(60);
    expect(info.limitTokens).toBe(90000);
    expect(info.resetRequestsMs).toBe(1200);
    expect(info.retryAfterMs).toBe(3000);
  });

  it("parses Anthropic-style headers", () => {
    const info = parseRateLimitHeaders(
      headers({
        "anthropic-ratelimit-requests-remaining": "40",
        "anthropic-ratelimit-tokens-remaining": "100000",
        "anthropic-ratelimit-requests-limit": "50",
        "anthropic-ratelimit-tokens-reset": "1m20s",
      }),
    );
    expect(info.remainingRequests).toBe(40);
    expect(info.remainingTokens).toBe(100000);
    expect(info.limitRequests).toBe(50);
    expect(info.resetTokensMs).toBe(80_000);
  });

  it("parses generic proxy headers (x-ratelimit-remaining)", () => {
    const info = parseRateLimitHeaders(
      headers({ "x-ratelimit-remaining": "10", "x-ratelimit-reset": "5" }),
    );
    expect(info.remainingRequests).toBe(10);
    expect(info.resetRequestsMs).toBe(5000);
  });

  it("returns empty object when no rate-limit headers present", () => {
    const info = parseRateLimitHeaders(headers({ "content-type": "application/json" }));
    expect(info).toEqual({});
    expect(hasRateLimitSignal(info)).toBe(false);
  });

  it("ignores malformed numeric values", () => {
    const info = parseRateLimitHeaders(
      headers({ "x-ratelimit-remaining-requests": "unlimited" }),
    );
    expect(info.remainingRequests).toBeUndefined();
  });

  it("parses compound duration suffixes", () => {
    expect(parseRateLimitHeaders(headers({ "x-ratelimit-reset-requests": "500ms" })).resetRequestsMs).toBe(500);
    expect(parseRateLimitHeaders(headers({ "x-ratelimit-reset-requests": "2m" })).resetRequestsMs).toBe(120_000);
    expect(parseRateLimitHeaders(headers({ "x-ratelimit-reset-requests": "1h30m" })).resetRequestsMs).toBe(5_400_000);
  });

  it("hasRateLimitSignal is true for any populated field", () => {
    expect(hasRateLimitSignal(parseRateLimitHeaders(headers({ "retry-after": "1" })))).toBe(true);
    expect(hasRateLimitSignal(undefined)).toBe(false);
    expect(hasRateLimitSignal({})).toBe(false);
  });
});
