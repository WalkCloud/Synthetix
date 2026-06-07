import { describe, it, expect, vi } from "vitest";
import { induceDocumentOutline, sizeForOutlineWindows } from "@/lib/documents/outline/induction";
import type { AtomicSpan } from "@/lib/documents/outline/spans";

function makeSpans(count: number): AtomicSpan[] {
  const spans: AtomicSpan[] = [];
  for (let i = 0; i < count; i++) {
    spans.push({
      id: `s_${String(i).padStart(4, "0")}`,
      type: "paragraph",
      text: `Paragraph ${i + 1} with enough text content to simulate a real document chunk for testing purposes.`,
      tokenCount: 10,
    });
  }
  return spans;
}

describe("sizeForOutlineWindows", () => {
  it("returns 1 window for fewer than 80 spans", () => {
    expect(sizeForOutlineWindows(makeSpans(10))).toEqual({ totalWindows: 1, spansPerWindow: 10 });
    expect(sizeForOutlineWindows(makeSpans(79))).toEqual({ totalWindows: 1, spansPerWindow: 79 });
  });

  it("returns multiple windows for 80+ spans", () => {
    const result = sizeForOutlineWindows(makeSpans(160));
    expect(result.totalWindows).toBeGreaterThanOrEqual(2);
    expect(result.spansPerWindow).toBeGreaterThanOrEqual(20);
  });
});

describe("induceDocumentOutline", () => {
  it("aggregates spans into outline from LLM response (mocked)", async () => {
    const spans = makeSpans(20);
    const mockChat = vi.fn(async () => ({
      content: JSON.stringify({
        outline: [
          { title: "Overview", startSpanId: "s_0000", endSpanId: "s_0004", summary: "Introduction" },
          { title: "Core Concepts", startSpanId: "s_0005", endSpanId: "s_0014", summary: "Core topics" },
          { title: "Conclusion", startSpanId: "s_0015", endSpanId: "s_0019", summary: "Wrap-up" },
        ],
        segments: [
          { title: "Overview", startSpanId: "s_0000", endSpanId: "s_0004", estimatedTokens: 600, reason: "Introduction material" },
          { title: "Core Concepts Part 1", startSpanId: "s_0005", endSpanId: "s_0009", estimatedTokens: 600, reason: "" },
          { title: "Core Concepts Part 2", startSpanId: "s_0010", endSpanId: "s_0014", estimatedTokens: 600, reason: "" },
          { title: "Conclusion", startSpanId: "s_0015", endSpanId: "s_0019", estimatedTokens: 600, reason: "" },
        ],
      }),
      inputTokens: 500,
      outputTokens: 200,
    }));

    const mockProvider = { chat: mockChat };
    const outline = await induceDocumentOutline({
      spans,
      writingModel: { modelId: "gpt-4", provider: { id: "p1", name: "test", providerType: "openai", apiBaseUrl: "", apiKey: null, userId: "user-1", isActive: true, createdAt: new Date(), updatedAt: new Date() } } as never,
      documentTitle: "Test Doc",
      maxSegmentationTokens: 6000,
    }, mockProvider as never);

    expect(outline).toBeTruthy();
    expect(outline.outline.length).toBe(3);
    expect(outline.outline[0].title).toBe("Overview");
    expect(outline.segments.length).toBe(4);
    expect(outline.segments[0].startSpanId).toBe("s_0000");
    expect(mockChat).toHaveBeenCalled();
  });

  it("falls back to auto-segmentation when LLM returns bad JSON", async () => {
    const spans = makeSpans(5);
    const mockChat = vi.fn(async () => ({
      content: "not valid json at all",
      inputTokens: 100,
      outputTokens: 20,
    }));

    const mockProvider = { chat: mockChat };
    const outline = await induceDocumentOutline({
      spans,
      writingModel: { modelId: "gpt-4", provider: { id: "p1", name: "test", providerType: "openai", apiBaseUrl: "", apiKey: null, userId: "user-1", isActive: true, createdAt: new Date(), updatedAt: new Date() } } as never,
      documentTitle: "Test Doc",
      maxSegmentationTokens: 300,
    }, mockProvider as never);

    expect(outline.segments.length).toBeGreaterThan(0);
  });
});
