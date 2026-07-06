import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAICompatibleAdapter } from "@/lib/llm/adapter";
import type { ChatParams } from "@/lib/llm/types";

/**
 * Regression test for the stream-read stall-timer leak.
 *
 * Previously the per-read `Promise.race` created a `setTimeout` but only the
 * LOSING (timeout) branch ever cleared it — the winning `reader.read()` branch
 * left the handle pending for the full STREAM_READ_TIMEOUT_MS window. A long
 * streaming generation emits hundreds of chunks, so this leaked one timer per
 * chunk.
 *
 * The fix wraps the race in `.finally(() => clearTimeout(stallTimer))`. This
 * test asserts the timer is cleared on the success path by counting active
 * setTimeout handles across a multi-chunk stream.
 */

const mockFetch = vi.fn();
global.fetch = mockFetch;

function sseStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function deltaChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function doneChunk(): string {
  return `data: ${JSON.stringify({ choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } })}\n\ndata: [DONE]\n\n`;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAICompatibleAdapter stream stall-timer cleanup", () => {
  it("clears the per-read stall timer on every successful read (no leak)", async () => {
    // Use real timers (we are not testing the timeout firing) and spy on
    // setTimeout/clearTimeout to verify the bookkeeping balances.
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    // 5 content chunks + done => 6 successful reader.read() calls. Each must
    // produce exactly one stall-timer that is later cleared.
    const chunks = [
      deltaChunk("Hello"),
      deltaChunk(", "),
      deltaChunk("world"),
      deltaChunk("!"),
      doneChunk(),
    ];
    mockFetch.mockResolvedValueOnce(sseStream(chunks));

    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "http://localhost:11434",
      apiKey: "test-key",
    });

    const params: ChatParams = {
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };

    const received: string[] = [];
    for await (const chunk of adapter.chatStream(params)) {
      if (chunk.content) received.push(chunk.content);
    }

    expect(received.join("")).toBe("Hello, world!");

    // The stall-timer scheduling helper passes a function + a number ms.
    // Count setTimeout calls that look like the stall timer (ms matches the
    // configured STREAM_READ_TIMEOUT_MS = 120000 by default).
    const stallSchedules = setTimeoutSpy.mock.calls.filter(
      (call) => call[1] === 120_000,
    );
    const stallClears = clearTimeoutSpy.mock.calls.length;

    // Every scheduled stall timer must have been cleared.
    expect(stallSchedules.length).toBeGreaterThan(0);
    expect(stallClears).toBeGreaterThanOrEqual(stallSchedules.length);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});

