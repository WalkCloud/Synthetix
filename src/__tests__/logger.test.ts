import { describe, it, expect } from "vitest";
import { logger, redact } from "@/lib/logger";

describe("redact", () => {
  it("redacts Bearer tokens", () => {
    expect(redact("Bearer sk-abc123")).toBe("[REDACTED]");
  });

  it("redacts sk- prefixed API keys", () => {
    expect(redact("sk-proj-xxxxxxxxxxxx")).toBe("[REDACTED]");
  });

  it("redacts long hex strings (likely API keys)", () => {
    expect(redact("a".repeat(40))).toBe("[REDACTED]");
  });

  it("truncates long content strings", () => {
    const long = "x".repeat(600);
    const result = redact(long) as string;
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain("[...truncated]");
  });

  it("preserves normal strings", () => {
    expect(redact("doc_abc123")).toBe("doc_abc123");
    expect(redact("Document processing started")).toBe("Document processing started");
  });

  it("redacts sensitive keys in objects", () => {
    const result = redact({ apiKey: "secret123", name: "test" }) as Record<string, unknown>;
    expect(result.apiKey).toBe("[REDACTED]");
    expect(result.name).toBe("test");
  });

  it("redacts sensitive keys case-insensitively", () => {
    const result = redact({ Token: "abc", APIKEY: "xyz" }) as Record<string, unknown>;
    expect(result.Token).toBe("[REDACTED]");
    expect(result.APIKEY).toBe("[REDACTED]");
  });

  it("handles arrays", () => {
    const result = redact(["sk-test", "normal"]) as unknown[];
    expect(result[0]).toBe("[REDACTED]");
    expect(result[1]).toBe("normal");
  });

  it("handles nested objects", () => {
    const result = redact({ outer: { secret: "hidden", visible: "ok" } }) as Record<string, unknown>;
    const inner = result.outer as Record<string, unknown>;
    expect(inner.secret).toBe("[REDACTED]");
    expect(inner.visible).toBe("ok");
  });
});

describe("logger", () => {
  it("exposes debug, info, warn, error methods", () => {
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("does not throw when called with meta", () => {
    expect(() => logger.info("test message", { key: "value" })).not.toThrow();
    expect(() => logger.warn("warning", { apiKey: "secret" })).not.toThrow();
    expect(() => logger.error("error", { detail: "x".repeat(600) })).not.toThrow();
  });

  it("does not throw when called without meta", () => {
    expect(() => logger.info("simple message")).not.toThrow();
  });

  it("exposes redact function", () => {
    expect(typeof logger.redact).toBe("function");
    expect(logger.redact("sk-test")).toBe("[REDACTED]");
  });
});
