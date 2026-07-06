import { describe, expect, it } from "vitest";
import {
  classifyGraphError,
  graphFailureWarning,
  graphRetryDelay,
  GRAPH_MAX_RETRIES,
  GRAPH_RETRY_BACKOFF_MS,
} from "@/lib/queue/workers/graph-error";

describe("classifyGraphError", () => {
  describe("retryable failures", () => {
    const cases: Array<[string, string]> = [
      ["rate limit", "Error: 429 Too Many Requests"],
      ["rate_limit (snake)", "rate_limit exceeded"],
      ["quota", "Request rate too many requests"],
      ["timeout", "Request timed out after 30000ms"],
      ["timeout (deadline)", "deadline exceeded"],
      ["network econnreset", "fetch failed: ECONNRESET"],
      ["network etimedout", "ETIMEDOUT"],
      ["network socket", "socket hang up"],
      ["5xx server", "HTTP 503 service unavailable"],
      ["502 gateway", "502 Bad Gateway"],
      ["overloaded", "provider overloaded"],
    ];
    for (const [label, msg] of cases) {
      it(`classifies "${label}" as retryable`, () => {
        const result = classifyGraphError(new Error(msg));
        expect(result.retryable).toBe(true);
        expect(result.type).not.toBe("unknown");
      });
    }
  });

  describe("non-retryable failures", () => {
    const cases: Array<[string, string]> = [
      ["auth 401", "401 Unauthorized"],
      ["auth forbidden", "403 permission denied"],
      ["config model not found", "model not found: gpt-x"],
      ["config invalid key", "invalid api key"],
      ["data dim mismatch", "embedding dimension mismatch (1024 vs 1536)"],
    ];
    for (const [label, msg] of cases) {
      it(`classifies "${label}" as NOT retryable`, () => {
        const result = classifyGraphError(new Error(msg));
        expect(result.retryable).toBe(false);
      });
    }
  });

  it("falls back to unknown + non-retryable for unrecognized errors", () => {
    const result = classifyGraphError(new Error("something completely different"));
    expect(result.retryable).toBe(false);
    expect(result.type).toBe("unknown");
  });

  it("handles non-Error thrown values", () => {
    const result = classifyGraphError("string error: 429 rate limit");
    expect(result.retryable).toBe(true);
    expect(result.type).toBe("rate_limit");
  });

  it("handles null/undefined gracefully", () => {
    expect(classifyGraphError(null).type).toBe("unknown");
    expect(classifyGraphError(undefined).type).toBe("unknown");
  });

  it("429 beats generic 5xx even if both substrings appear", () => {
    // "429" should match the rate_limit rule, not fall through to a 5xx rule.
    const result = classifyGraphError(new Error("429 plus 500 in the same message"));
    expect(result.type).toBe("rate_limit");
  });
});

describe("graph retry config", () => {
  it("GRAPH_MAX_RETRIES defaults to 2 when env unset", () => {
    expect(GRAPH_MAX_RETRIES).toBe(2);
  });

  it("GRAPH_RETRY_BACKOFF_MS defaults to [2min, 10min]", () => {
    expect(GRAPH_RETRY_BACKOFF_MS).toEqual([120_000, 600_000]);
  });

  it("graphRetryDelay returns backoff[attempt] and clamps to last value", () => {
    expect(graphRetryDelay(0)).toBe(120_000);
    expect(graphRetryDelay(1)).toBe(600_000);
    // attempt beyond array length clamps to last element, never undefined
    expect(graphRetryDelay(99)).toBe(600_000);
  });
});

describe("graphFailureWarning", () => {
  it("produces a transient-service warning for retryable types", () => {
    const w = graphFailureWarning("rate_limit", true);
    expect(w.toLowerCase()).toContain("basic search remains available");
    expect(w.toLowerCase()).toContain("retry");
  });

  it("produces a config/auth warning for non-retryable auth/config types", () => {
    const w = graphFailureWarning("auth", false);
    expect(w.toLowerCase()).toContain("configuration");
    expect(w.toLowerCase()).toContain("basic search remains available");
  });

  it("produces a generic warning for other non-retryable types", () => {
    const w = graphFailureWarning("unknown", false);
    expect(w.toLowerCase()).toContain("basic search remains available");
  });
});
