import type { AtomicSpan } from "@/lib/documents/outline/spans";
import type { OutlineResult } from "@/lib/documents/outline/induction";
import type { SplitChunk } from "@/lib/documents/splitter";

export function executeSegmentationPlan(
  plan: OutlineResult,
  spans: AtomicSpan[],
): SplitChunk[] {
  if (plan.segments.length === 0 || spans.length === 0) return [];

  const spanMap = new Map<string, AtomicSpan>();
  for (const span of spans) {
    spanMap.set(span.id, span);
  }

  const chunks: SplitChunk[] = [];

  for (let segIdx = 0; segIdx < plan.segments.length; segIdx++) {
    const seg = plan.segments[segIdx];
    const startSpan = spanMap.get(seg.startSpanId);
    const endSpan = spanMap.get(seg.endSpanId);
    if (!startSpan || !endSpan) continue;

    const startIdx = spans.indexOf(startSpan);
    const endIdx = spans.indexOf(endSpan);
    if (startIdx < 0 || endIdx < startIdx) continue;

    const segSpans = spans.slice(startIdx, endIdx + 1);
    const content = segSpans.map((s) => s.text).join("\n\n");
    const tokenCount = segSpans.reduce((sum, s) => sum + s.tokenCount, 0);

    const headingSpans = segSpans.filter((s) => s.type === "heading");
    const headingPath = headingSpans.length > 0
      ? headingSpans.map((h) => h.text).join(" > ")
      : seg.title;

    chunks.push({
      index: segIdx,
      title: seg.title,
      content,
      tokenCount,
      headingPath,
    });
  }

  return chunks;
}
