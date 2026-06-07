import { describe, it, expect } from "vitest";
import { validateAndRepairSegmentationPlan } from "@/lib/documents/outline/segmentation";
import { executeSegmentationPlan } from "@/lib/documents/outline/executor";
import { enforceEmbeddingSafeChunks } from "@/lib/documents/outline/guard";
import type { AtomicSpan } from "@/lib/documents/outline/spans";

function makeSpans(count: number): AtomicSpan[] {
  const spans: AtomicSpan[] = [];
  for (let i = 0; i < count; i++) {
    spans.push({
      id: `s_${String(i).padStart(4, "0")}`,
      type: i % 10 === 0 ? "heading" : "paragraph",
      text: `Span ${i} content here for testing. `.repeat(5),
      tokenCount: 25, // ~25 tokens each
      headingLevel: i % 10 === 0 ? 2 : undefined,
    });
  }
  return spans;
}

describe("validateAndRepairSegmentationPlan", () => {
  it("accepts a valid plan with no gaps", () => {
    const spans = makeSpans(20);
    const plan = {
      outline: [],
      segments: [
        { title: "Part 1", startSpanId: "s_0000", endSpanId: "s_0009", estimatedTokens: 250, reason: "" },
        { title: "Part 2", startSpanId: "s_0010", endSpanId: "s_0019", estimatedTokens: 250, reason: "" },
      ],
    };

    const validated = validateAndRepairSegmentationPlan(plan, spans, 6000);

    expect(validated.segments.length).toBe(2);
    expect(validated.segments[0].startSpanId).toBe("s_0000");
    expect(validated.segments[0].endSpanId).toBe("s_0009");
    expect(validated.segments[1].startSpanId).toBe("s_0010");
    expect(validated.segments[1].endSpanId).toBe("s_0019");
  });

  it("auto-repairs a plan with a gap between segments", () => {
    const spans = makeSpans(20);
    const plan = {
      outline: [],
      segments: [
        { title: "Part 1", startSpanId: "s_0000", endSpanId: "s_0005", estimatedTokens: 150, reason: "" },
        { title: "Part 2", startSpanId: "s_0010", endSpanId: "s_0019", estimatedTokens: 250, reason: "" },
      ],
    };

    const validated = validateAndRepairSegmentationPlan(plan, spans, 6000);

    expect(validated.segments.length).toBe(3);
    expect(validated.segments[0].endSpanId).toBe("s_0005");
    expect(validated.segments[1].startSpanId).toBe("s_0006");
    expect(validated.segments[1].endSpanId).toBe("s_0009");
  });

  it("auto-repairs a plan where a segment is too large", () => {
    const spans = makeSpans(20);
    const plan = {
      outline: [],
      segments: [
        { title: "Oversized", startSpanId: "s_0000", endSpanId: "s_0019", estimatedTokens: 99999, reason: "" },
      ],
    };

    const validated = validateAndRepairSegmentationPlan(plan, spans, 300);

    expect(validated.segments.length).toBeGreaterThan(1);
    for (const seg of validated.segments) {
      const startIdx = spans.findIndex((s) => s.id === seg.startSpanId);
      const endIdx = spans.findIndex((s) => s.id === seg.endSpanId);
      const tokens = spans.slice(startIdx, endIdx + 1).reduce((sum, s) => sum + s.tokenCount, 0);
      expect(tokens).toBeLessThanOrEqual(300);
    }
  });

  it("auto-repairs empty plan", () => {
    const spans = makeSpans(5);
    const validated = validateAndRepairSegmentationPlan({ outline: [], segments: [] }, spans, 6000);

    expect(validated.segments.length).toBeGreaterThan(0);
    expect(validated.segments[0].startSpanId).toBe("s_0000");
    expect(validated.segments[validated.segments.length - 1].endSpanId).toBe("s_0004");
  });
});

describe("executeSegmentationPlan", () => {
  it("assembles final chunks from a segmentation plan", () => {
    const spans = makeSpans(10);
    const plan = {
      outline: [],
      segments: [
        { title: "First", startSpanId: "s_0000", endSpanId: "s_0004", estimatedTokens: 125, reason: "" },
        { title: "Second", startSpanId: "s_0005", endSpanId: "s_0009", estimatedTokens: 125, reason: "" },
      ],
    };

    const chunks = executeSegmentationPlan(plan, spans);

    expect(chunks.length).toBe(2);
    expect(chunks[0].title).toBe("First");
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
    expect(chunks[0].content).toContain("Span 0");
    expect(chunks[1].title).toBe("Second");
    expect(chunks[1].index).toBe(1);
  });

  it("content is not rewritten by LLM", () => {
    const spans: AtomicSpan[] = [
      { id: "s_0000", type: "paragraph", text: "Exact original text ABC 123", tokenCount: 10 },
      { id: "s_0001", type: "paragraph", text: "More original content XYZ 456", tokenCount: 10 },
    ];
    const plan = {
      outline: [],
      segments: [
        { title: "Test", startSpanId: "s_0000", endSpanId: "s_0001", estimatedTokens: 20, reason: "" },
      ],
    };

    const chunks = executeSegmentationPlan(plan, spans);
    expect(chunks[0].content).toBe("Exact original text ABC 123\n\nMore original content XYZ 456");
  });
});

describe("enforceEmbeddingSafeChunks", () => {
  it("splits oversized chunk into smaller ones", () => {
    const longLine = "A".repeat(200) + "\n";
    const bigContent = longLine.repeat(80); // 80 lines, ~10720 tokens
    const chunks = [{
      index: 0,
      title: "Big",
      content: bigContent,
      tokenCount: 11000,
      headingPath: "Test",
    }];

    const safe = enforceEmbeddingSafeChunks(chunks, 8000);
    expect(safe.length).toBeGreaterThan(1);
    expect(safe[0].tokenCount).toBeLessThanOrEqual(8000);
    expect(safe[1].tokenCount).toBeLessThanOrEqual(8000);
  });

  it("passes through already-safe chunks unchanged", () => {
    const chunks = [
      { index: 0, title: "A", content: "Hello", tokenCount: 5, headingPath: "" },
      { index: 1, title: "B", content: "World", tokenCount: 5, headingPath: "" },
    ];

    const safe = enforceEmbeddingSafeChunks(chunks, 100);
    expect(safe).toEqual(chunks);
  });
});
