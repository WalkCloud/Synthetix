import { describe, it, expect } from "vitest";
import {
  normalizeProviderBaseUrl,
  buildChatCompletionsUrl,
  buildEmbeddingsUrl,
  buildModelsUrl,
  buildProviderHeaders,
} from "@/lib/llm/provider-endpoints";

describe("normalizeProviderBaseUrl", () => {
  it("removes trailing slashes", () => {
    expect(normalizeProviderBaseUrl("https://api.openai.com/")).toBe("https://api.openai.com");
    expect(normalizeProviderBaseUrl("https://api.openai.com///")).toBe("https://api.openai.com");
  });

  it("removes /embeddings suffix", () => {
    expect(normalizeProviderBaseUrl("https://api.example.com/v1/embeddings")).toBe("https://api.example.com");
  });

  it("removes /chat/completions suffix", () => {
    expect(normalizeProviderBaseUrl("https://api.openai.com/v1/chat/completions")).toBe("https://api.openai.com");
  });

  it("removes /v1/embeddings with dimension variant", () => {
    expect(normalizeProviderBaseUrl("https://api.example.com/v1/embeddings/1536")).toBe("https://api.example.com");
  });

  it("removes /vN version suffix only", () => {
    expect(normalizeProviderBaseUrl("https://api.openai.com/v1")).toBe("https://api.openai.com");
    expect(normalizeProviderBaseUrl("https://api.deepseek.com/v2")).toBe("https://api.deepseek.com");
  });

  it("handles Ollama localhost URLs", () => {
    expect(normalizeProviderBaseUrl("http://localhost:11434")).toBe("http://localhost:11434");
    expect(normalizeProviderBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434");
  });

  it("handles clean base URL without changes", () => {
    expect(normalizeProviderBaseUrl("https://api.openai.com")).toBe("https://api.openai.com");
  });

  it("handles complex URL with multiple path segments", () => {
    expect(normalizeProviderBaseUrl("https://proxy.example.com/llm/v1/chat/completions")).toBe("https://proxy.example.com/llm");
  });
});

describe("buildChatCompletionsUrl", () => {
  it("builds full chat completions URL from base", () => {
    expect(buildChatCompletionsUrl("https://api.openai.com")).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("normalizes base before building", () => {
    expect(buildChatCompletionsUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("buildEmbeddingsUrl", () => {
  it("builds full embeddings URL from base", () => {
    expect(buildEmbeddingsUrl("https://api.openai.com")).toBe("https://api.openai.com/v1/embeddings");
  });
});

describe("buildModelsUrl", () => {
  it("builds full models URL from base", () => {
    expect(buildModelsUrl("https://api.openai.com")).toBe("https://api.openai.com/v1/models");
  });
});

describe("buildProviderHeaders", () => {
  it("returns Content-Type header without API key", () => {
    const headers = buildProviderHeaders();
    expect(headers).toEqual({ "Content-Type": "application/json" });
  });

  it("includes Authorization header with API key", () => {
    const headers = buildProviderHeaders("sk-test-key");
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-test-key",
    });
  });

  it("omits Authorization for empty string", () => {
    const headers = buildProviderHeaders("");
    expect(headers).toEqual({ "Content-Type": "application/json" });
  });
});
