import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAICompatibleAdapter } from "@/lib/llm/adapter";
import * as retryAfter from "@/lib/llm/retry-after";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Stage-0 correctness guarantee (see docs/llm-concurrency-adaptive-limiter-2026-06-26.md §6):
 * a strict provider bans clients that 429-then-retry on their own clock. The
 * adapter MUST honour the server's Retry-After header rather than a hardcoded
 * exponential delay. These tests pin that behaviour so a regression is caught.
 */
describe("OpenAICompatibleAdapter retry-after honouring", () => {
  it("chat: waits the Retry-After value before retrying a 429", async () => {
    const delaySpy = vi.spyOn(retryAfter, "delayWithSignal").mockResolvedValue(undefined);

    // First call → 429 with Retry-After: 12; second call → success.
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429, { "retry-after": "12" }))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "m",
        }),
      );

    const adapter = new OpenAICompatibleAdapter({ baseUrl: "http://x", apiKey: "k" });
    await adapter.chat({ model: "m", messages: [{ role: "user", content: "hi" }] });

    // delay must have been called with ~12000ms (±jitter), NOT the old hardcoded 2000.
    expect(delaySpy).toHaveBeenCalledTimes(1);
    const waited = delaySpy.mock.calls[0][0] as number;
    expect(waited).toBeGreaterThanOrEqual(9_000); // 12000 × 0.75
    expect(waited).toBeLessThanOrEqual(15_000); // 12000 × 1.25
  });

  it("chat: falls back to exponential when no Retry-After header", async () => {
    const delaySpy = vi.spyOn(retryAfter, "delayWithSignal").mockResolvedValue(undefined);

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "m",
        }),
      );

    const adapter = new OpenAICompatibleAdapter({ baseUrl: "http://x", apiKey: "k" });
    await adapter.chat({ model: "m", messages: [{ role: "user", content: "hi" }] });

    expect(delaySpy).toHaveBeenCalledTimes(1);
    const waited = delaySpy.mock.calls[0][0] as number;
    // First retry (attemptRemaining=3) → 2s base ±25%.
    expect(waited).toBeGreaterThanOrEqual(1_500);
    expect(waited).toBeLessThanOrEqual(2_500);
  });

  it("embed: honours Retry-After on 429 before retrying", async () => {
    const delaySpy = vi.spyOn(retryAfter, "delayWithSignal").mockResolvedValue(undefined);

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429, { "retry-after": "8" }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [0.1] }] }));

    const adapter = new OpenAICompatibleAdapter({ baseUrl: "http://x", apiKey: "k" });
    await adapter.embed(["hi"]);

    expect(delaySpy).toHaveBeenCalledTimes(1);
    const waited = delaySpy.mock.calls[0][0] as number;
    expect(waited).toBeGreaterThanOrEqual(6_000); // 8000 × 0.75
    expect(waited).toBeLessThanOrEqual(10_000);
  });

  it("chat: honours Retry-After on 5xx too (server-overload path)", async () => {
    const delaySpy = vi.spyOn(retryAfter, "delayWithSignal").mockResolvedValue(undefined);

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "overloaded" }, 503, { "retry-after": "20" }))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "m",
        }),
      );

    const adapter = new OpenAICompatibleAdapter({ baseUrl: "http://x", apiKey: "k" });
    await adapter.chat({ model: "m", messages: [{ role: "user", content: "hi" }] });

    const waited = delaySpy.mock.calls[0][0] as number;
    expect(waited).toBeGreaterThanOrEqual(15_000); // 20000 × 0.75
    expect(waited).toBeLessThanOrEqual(25_000);
  });

  it("gives up after max retries even with Retry-After", async () => {
    vi.spyOn(retryAfter, "delay").mockResolvedValue(undefined);

    mockFetch.mockResolvedValue(
      jsonResponse({ error: "rate limited" }, 429, { "retry-after": "1" }),
    );

    const adapter = new OpenAICompatibleAdapter({ baseUrl: "http://x", apiKey: "k" });
    await expect(
      adapter.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("Chat request failed (429)");

    // Initial attempt + 3 retries = 4 total calls.
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
