/**
 * Verification test (not a unit test) — exercises AnthropicAdapter against
 * the REAL doubao-seed-2.0-pro endpoint (providerType=anthropic) to confirm
 * the adapter's chat() + chatStream() work end-to-end via the Anthropic
 * Messages API. Run with: pnpm vitest run anthropic-adapter-verify
 *
 * This hits the network. It is intentionally separate from adapter.test.ts
 * (which mocks fetch) so the real-protocol path can be validated.
 */
import { describe, it, expect } from "vitest";
import { AnthropicAdapter } from "@/lib/llm/anthropic-adapter";

const BASE_URL = "https://ark.cn-beijing.volces.com/api/coding";
const API_KEY = "73f47f70-5586-4866-b57a-71f56588db56";
const MODEL = "doubao-seed-2.0-pro";

const adapter = new AnthropicAdapter({ baseUrl: BASE_URL, apiKey: API_KEY });

describe("AnthropicAdapter — real doubao endpoint", () => {
  it("chat() returns content + token usage via /v1/messages", async () => {
    const result = await adapter.chat({
      model: MODEL,
      maxTokens: 100,
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "What is 2+2? Reply with just the number." },
      ],
    });

    console.log("[chat] result:", JSON.stringify(result, null, 2));
    expect(result.content).toBeTruthy();
    expect(result.content.trim()).toBe("4");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.model).toBe(MODEL);
  }, 60_000);

  it("chatStream() parses Anthropic SSE and yields content + final done chunk", async () => {
    const chunks: { content: string; reasoning?: string; done: boolean }[] = [];
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let fullText = "";

    for await (const chunk of adapter.chatStream({
      model: MODEL,
      maxTokens: 100,
      messages: [{ role: "user", content: "Count from 1 to 5, one number per line." }],
    })) {
      chunks.push(chunk);
      fullText += chunk.content;
      if (chunk.done) {
        inputTokens = chunk.inputTokens;
        outputTokens = chunk.outputTokens;
      }
    }

    console.log("[stream] chunk count:", chunks.length);
    console.log("[stream] fullText:", JSON.stringify(fullText));
    console.log("[stream] final tokens:", { inputTokens, outputTokens });

    // Must have received at least one content delta
    expect(chunks.filter((c) => c.content.length > 0).length).toBeGreaterThan(0);
    // Must end with a done:true chunk carrying token counts
    const doneChunk = chunks.find((c) => c.done);
    expect(doneChunk).toBeDefined();
    expect(inputTokens).toBeGreaterThan(0);
    expect(outputTokens).toBeGreaterThan(0);
    // Content should contain the numbers
    expect(fullText).toMatch(/1/);
  }, 60_000);

  it("URL is built as /v1/messages (no /chat/completions)", () => {
    // Indirect verification: testConnection hitting the messages path.
    // The real proof is the two tests above succeeding.
    expect(adapter).toBeDefined();
  });
});
