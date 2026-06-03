import { describe, it, expect, vi } from "vitest";
import { buildEmbedConfig } from "@/lib/rag/context";

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((v: string) => `decrypted_${v}`),
}));

describe("buildEmbedConfig", () => {
  it("builds config from model with api key", () => {
    const config = buildEmbedConfig({
      provider: { apiBaseUrl: "https://api.openai.com/v1", apiKey: "encrypted-key" },
      modelId: "text-embedding-3-small",
    });

    expect(config.apiBase).toBe("https://api.openai.com");
    expect(config.apiKey).toBe("decrypted_encrypted-key");
    expect(config.model).toBe("text-embedding-3-small");
  });

  it("handles null apiKey by returning empty string", () => {
    const config = buildEmbedConfig({
      provider: { apiBaseUrl: "http://localhost:11434", apiKey: null },
      modelId: "nomic-embed-text",
    });

    expect(config.apiKey).toBe("");
    expect(config.apiBase).toBe("http://localhost:11434");
  });

  it("normalizes trailing slash from apiBaseUrl", () => {
    const config = buildEmbedConfig({
      provider: { apiBaseUrl: "https://api.deepseek.com/v1/", apiKey: "key" },
      modelId: "deepseek-embed",
    });

    expect(config.apiBase).toBe("https://api.deepseek.com");
  });
});
