import type { AtomicSpan } from "@/lib/documents/outline/spans";
import type { OutlineResult, SegmentationSegment } from "@/lib/documents/outline/induction";

export function validateAndRepairSegmentationPlan(
  plan: OutlineResult,
  spans: AtomicSpan[],
  maxTokens: number,
): OutlineResult {
  if (spans.length === 0) return { outline: [], segments: [] };
  if (plan.segments.length === 0) {
    return { outline: [], segments: autoSegment(spans, maxTokens) };
  }

  const spanIdx = new Map<string, number>();
  spans.forEach((s, i) => spanIdx.set(s.id, i));

  const sorted = [...plan.segments].sort((a, b) => {
    const ai = spanIdx.get(a.startSpanId) ?? 0;
    const bi = spanIdx.get(b.startSpanId) ?? 0;
    return ai - bi;
  });

  const repaired: SegmentationSegment[] = [];
  let expectedNext = 0;

  for (const seg of sorted) {
    const startIdx = spanIdx.get(seg.startSpanId);
    const endIdx = spanIdx.get(seg.endSpanId);

    if (startIdx === undefined || endIdx === undefined) continue;
    if (startIdx > endIdx) continue;

    // Fill gap before this segment
    if (startIdx > expectedNext) {
      const gapSpans = spans.slice(expectedNext, startIdx);
      const gapSegments = autoSegment(gapSpans, maxTokens);
      for (const gs of gapSegments) {
        const gsStartIdx = spans.findIndex((s) => s.id === gs.startSpanId);
        const gsEndIdx = spans.findIndex((s) => s.id === gs.endSpanId);
        repaired.push({
          ...gs,
          startSpanId: gsStartIdx >= 0 ? spans[gsStartIdx].id : gs.startSpanId,
          endSpanId: gsEndIdx >= 0 ? spans[gsEndIdx].id : gs.endSpanId,
          reason: "Auto-filled gap",
        });
      }
    }

    // Check if segment itself is too large
    const segSpans = spans.slice(startIdx, endIdx + 1);
    const segTokens = segSpans.reduce((sum, s) => sum + s.tokenCount, 0);

    if (segTokens > maxTokens && segSpans.length > 1) {
      const subSegs = autoSegment(segSpans, maxTokens);
      for (const sub of subSegs) {
        const subStartIdx = startIdx + (spans.slice(startIdx).findIndex((s) => s.id === sub.startSpanId));
        const subEndIdx = startIdx + (spans.slice(startIdx).findIndex((s) => s.id === sub.endSpanId));
        const actualStartId = spans[Math.max(0, subStartIdx)]?.id ?? sub.startSpanId;
        const actualEndId = spans[Math.min(spans.length - 1, subEndIdx)]?.id ?? sub.endSpanId;
        repaired.push({
          title: seg.title,
          startSpanId: actualStartId,
          endSpanId: actualEndId,
          estimatedTokens: sub.estimatedTokens,
          reason: `Sub-segment of: ${seg.reason || seg.title}`,
        });
      }
    } else {
      repaired.push(seg);
    }

    expectedNext = endIdx + 1;
  }

  // Append remaining spans
  if (expectedNext < spans.length) {
    const tailSpans = spans.slice(expectedNext);
    const tailSegs = autoSegment(tailSpans, maxTokens);
    for (const ts of tailSegs) {
      repaired.push(ts);
    }
  }

  if (repaired.length === 0) {
    return { outline: plan.outline, segments: autoSegment(spans, maxTokens) };
  }

  // Renumber and verify coverage
  let covered = 0;
  for (const seg of repaired) {
    const si = spanIdx.get(seg.startSpanId);
    const ei = spanIdx.get(seg.endSpanId);
    if (si !== undefined && ei !== undefined && si <= ei) {
      covered += (ei - si + 1);
    }
  }
  if (covered < spans.length) {
    return { outline: plan.outline, segments: autoSegment(spans, maxTokens) };
  }

  return { outline: plan.outline, segments: repaired };
}

function autoSegment(spans: AtomicSpan[], maxTokens: number): SegmentationSegment[] {
  if (spans.length === 0) return [];
  const segments: SegmentationSegment[] = [];
  let currentStart = 0;

  while (currentStart < spans.length) {
    let currentEnd = currentStart;
    let accumulated = 0;

    while (currentEnd < spans.length && accumulated + spans[currentEnd].tokenCount <= maxTokens) {
      accumulated += spans[currentEnd].tokenCount;
      currentEnd++;
    }

    if (currentEnd === currentStart) {
      currentEnd = currentStart + 1;
    }

    const endIdx = currentEnd - 1;
    const title = spans[currentStart].type === "heading" ? spans[currentStart].text : `Segment ${segments.length + 1}`;

    segments.push({
      title,
      startSpanId: spans[currentStart].id,
      endSpanId: spans[endIdx].id,
      estimatedTokens: spans.slice(currentStart, endIdx + 1).reduce((sum, s) => sum + s.tokenCount, 0),
      reason: "Auto-segmented",
    });

    currentStart = currentEnd;
  }

  return segments;
}
