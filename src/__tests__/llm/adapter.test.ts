import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAICompatibleAdapter } from "@/lib/llm/adapter";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("OpenAICompatibleAdapter", () => {
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: "http://localhost:11434",
    apiKey: "test-key",
  });

  const adapterNoAuth = new OpenAICompatibleAdapter({
    baseUrl: "http://localhost:11434",
  });

  describe("testConnection", () => {
    it("returns true on successful connection", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

      const result = await adapter.testConnection();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/v1/models",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-key",
          }),
        })
      );
    });

    it("returns false on failed connection", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "unauthorized" }, 401)
      );

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });

    it("omits Authorization header when no API key", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

      await adapterNoAuth.testConnection();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/v1/models",
        expect.objectContaining({
          method: "GET",
          headers: expect.not.objectContaining({
            Authorization: expect.anything(),
          }),
        })
      );
    });
  });

  describe("getModels", () => {
    it("parses model list response correctly", async () => {
      const modelsData = {
        data: [
          { id: "llama3", object: "model" },
          { id: "mistral", object: "model" },
        ],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(modelsData));

      const models = await adapter.getModels();

      expect(models).toEqual([
        { id: "llama3", name: "llama3", type: "model" },
        { id: "mistral", name: "mistral", type: "model" },
      ]);
    });

    it("handles models without object field", async () => {
      const modelsData = {
        data: [{ id: "custom-model", type: "chat" }],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(modelsData));

      const models = await adapter.getModels();

      expect(models).toEqual([
        { id: "custom-model", name: "custom-model", type: "chat" },
      ]);
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "server error" }, 500)
      );

      await expect(adapter.getModels()).rejects.toThrow(
        "Get models failed (500)"
      );
    });
  });

  describe("chat", () => {
    it("sends correct request and parses response", async () => {
      const chatResponse = {
        choices: [{ message: { content: "Hello, world!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: "llama3",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(chatResponse));

      const result = await adapter.chat({
        model: "llama3",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Say hello." },
        ],
        temperature: 0.7,
        maxTokens: 100,
      });

      expect(result).toEqual({
        content: "Hello, world!",
        inputTokens: 10,
        outputTokens: 5,
        model: "llama3",
      });

      const callBody = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string
      );
      expect(callBody).toEqual({
        model: "llama3",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Say hello." },
        ],
        temperature: 0.7,
        max_tokens: 100,
        stream: false,
      });
    });

    it("omits optional fields when not provided", async () => {
      const chatResponse = {
        choices: [{ message: { content: "Hi" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
        model: "test",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(chatResponse));

      await adapter.chat({
        model: "test",
        messages: [{ role: "user", content: "Hi" }],
      });

      const callBody = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string
      );
      expect(callBody).toEqual({
        model: "test",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      });
      expect(callBody).not.toHaveProperty("temperature");
      expect(callBody).not.toHaveProperty("max_tokens");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "bad request" }, 400)
      );

      await expect(
        adapter.chat({
          model: "bad-model",
          messages: [{ role: "user", content: "test" }],
        })
      ).rejects.toThrow("Chat request failed (400)");
    });

    it("uses model param as fallback when response model is missing", async () => {
      const chatResponse = {
        choices: [{ message: { content: "response" } }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(chatResponse));

      const result = await adapter.chat({
        model: "fallback-model",
        messages: [{ role: "user", content: "test" }],
      });

      expect(result.model).toBe("fallback-model");
    });
  });

  describe("embed", () => {
    it("sends correct request and returns embeddings", async () => {
      const embedResponse = {
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] },
        ],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(embedResponse));

      const result = await adapter.embed(["hello", "world"]);

      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);

      const callBody = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string
      );
      expect(callBody).toEqual({
        input: ["hello", "world"],
        model: "text-embedding",
      });
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "not found" }, 404)
      );

      await expect(adapter.embed(["test"])).rejects.toThrow(
        "Embed request failed (404)"
      );
    });
  });

  describe("baseUrl normalization", () => {
    it("strips trailing slashes from baseUrl", async () => {
      const trailingAdapter = new OpenAICompatibleAdapter({
        baseUrl: "http://localhost:11434///",
      });
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

      await trailingAdapter.testConnection();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/v1/models",
        expect.anything()
      );
    });
  });
});
