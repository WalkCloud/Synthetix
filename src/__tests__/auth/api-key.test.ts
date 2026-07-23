import { describe, it, expect } from "vitest";
import {
  generateApiKeyMaterial,
  hashApiKey,
  extractBearerToken,
  API_KEY_PREFIX,
} from "@/lib/auth/api-key";

describe("api-key material generation", () => {
  it("generates a key with the recognizable prefix", () => {
    const { plaintext, keyPrefix } = generateApiKeyMaterial("test");
    expect(plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(keyPrefix).toBe(API_KEY_PREFIX);
    // 主体应有足够长度(base64url 编码 24 字节 ≈ 32 字符)。
    expect(plaintext.length).toBeGreaterThan(API_KEY_PREFIX.length + 20);
  });

  it("produces a unique key each call", () => {
    const a = generateApiKeyMaterial("a");
    const b = generateApiKeyMaterial("b");
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hashedKey).not.toBe(b.hashedKey);
  });

  it("derives a stable last-4 from the plaintext", () => {
    const { plaintext, keyLast4 } = generateApiKeyMaterial("test");
    expect(plaintext.endsWith(keyLast4)).toBe(true);
    expect(keyLast4.length).toBe(4);
  });

  it("captures the provided name", () => {
    const { name } = generateApiKeyMaterial("Claude Code MCP");
    expect(name).toBe("Claude Code MCP");
  });
});

describe("api-key hashing", () => {
  it("produces a deterministic hex digest", () => {
    const plaintext = "sk-synt-test-key";
    expect(hashApiKey(plaintext)).toBe(hashApiKey(plaintext));
  });

  it("produces a 64-char hex string (SHA-256)", () => {
    expect(hashApiKey("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across inputs", () => {
    expect(hashApiKey("a")).not.toBe(hashApiKey("b"));
  });
});

describe("bearer token extraction", () => {
  it("extracts a standard Bearer token", () => {
    expect(extractBearerToken("Bearer sk-synt-abc")).toBe("sk-synt-abc");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken("bearer sk-synt-abc")).toBe("sk-synt-abc");
  });

  it("tolerates extra whitespace", () => {
    expect(extractBearerToken("  Bearer   sk-synt-abc  ")).toBe("sk-synt-abc");
  });

  it("returns null for missing or malformed headers", () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken("sk-synt-no-scheme")).toBeNull();
  });
});
