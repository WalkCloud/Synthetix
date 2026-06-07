import type { AtomicSpan } from "@/lib/documents/outline/spans";
import { createLLMProvider } from "@/lib/llm/factory";
import type { ModelConfig, ModelProvider } from "@/generated/prisma/client";

const WINDOW_SPANS = 30;
const WINDOW_OVERLAP = 6;
const LARGE_DOC_BOUNDARY = 80; // spans threshold for windowed mode
const SMALL_DOC_TOKEN_THRESHOLD = 40000;

export interface DocumentOutlineNode {
  title: string;
  startSpanId: string;
  endSpanId: string;
  summary: string;
}

export interface SegmentationSegment {
  title: string;
  startSpanId: string;
  endSpanId: string;
  estimatedTokens: number;
  reason: string;
}

export interface OutlineResult {
  outline: DocumentOutlineNode[];
  segments: SegmentationSegment[];
}

interface LLMProvider {
  chat(params: {
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ content: string; inputTokens: number; outputTokens: number }>;
}

export interface OutlineInductionInput {
  spans: AtomicSpan[];
  writingModel: ModelConfig & { provider: ModelProvider };
  documentTitle: string;
  maxSegmentationTokens: number;
}

export function sizeForOutlineWindows(spans: AtomicSpan[]): { totalWindows: number; spansPerWindow: number } {
  if (spans.length < LARGE_DOC_BOUNDARY) {
    return { totalWindows: 1, spansPerWindow: spans.length };
  }
  const totalWindows = Math.ceil(spans.length / (WINDOW_SPANS - WINDOW_OVERLAP));
  const spansPerWindow = Math.ceil(spans.length / totalWindows);
  return { totalWindows, spansPerWindow };
}

async function singlePassOutline(
  input: OutlineInductionInput,
  provider: LLMProvider,
): Promise<OutlineResult> {
  const safeLimit = Math.floor(input.maxSegmentationTokens * 0.85);

  const spanSummary = input.spans.map((s) => ({
    id: s.id,
    type: s.type,
    tokens: s.tokenCount,
    preview: s.text.slice(0, 200).replace(/\n/g, " "),
  }));

  const headings = input.spans.filter((s) => s.type === "heading");
  const headingLines = headings.map((h) => `${"#".repeat(h.headingLevel || 1)} ${h.text}`).join("\n");

  const totalTokens = input.spans.reduce((sum, s) => sum + s.tokenCount, 0);

  const prompt = `You are analyzing a document for optimal chunking into information retrieval segments.

## Document Title
${input.documentTitle}

## Document Structure (headings found)
${headingLines || "(no headings - this document has no explicit section structure)"}

## Content Spans (${input.spans.length} total spans, ~${totalTokens} tokens)
${JSON.stringify(spanSummary, null, 2)}

## Task
1. If the document has clear section headings, use them as your primary structure.
   If not, infer an implicit outline from topic drift in the content spans.
2. Group spans into segments. Each segment should be ${Math.floor(safeLimit / 4)}-${safeLimit} tokens.
   Each segment should cover ONE complete topic or sub-topic — don't split topics mid-way.
3. Some sections may be too large for one segment. Split them naturally at sub-topic boundaries.
   Indicate in the "reason" field why this split boundary was chosen.
4. The hard limit per segment is ${safeLimit} tokens. Segments exceeding this will be rejected.

## Output Format
Return ONLY a valid JSON object with this structure:
{
  "outline": [
    { "title": "Section title", "startSpanId": "s_0000", "endSpanId": "s_0005", "summary": "Brief summary of this section" }
  ],
  "segments": [
    { "title": "Segment title", "startSpanId": "s_0000", "endSpanId": "s_0004", "estimatedTokens": 1200, "reason": "Introduces the core concepts of X" }
  ]
}
- Every span from ${input.spans[0]?.id} to ${input.spans[input.spans.length - 1]?.id} must be covered exactly once.
- No gaps between segments.
- Each segment's estimatedTokens must be <= ${safeLimit}.`;

  const response = await provider.chat({
    model: input.writingModel.modelId,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    maxTokens: 4096,
  });

  const parsed = parseOutlineResponse(response.content, input.spans, safeLimit);
  if (parsed) return parsed;

  return fallbackAutoSegmentation(input.spans, safeLimit);
}

async function windowedOutline(
  input: OutlineInductionInput,
  provider: LLMProvider,
): Promise<OutlineResult> {
  const { spansPerWindow } = sizeForOutlineWindows(input.spans);
  const safeLimit = Math.floor(input.maxSegmentationTokens * 0.85);

  // Phase A: concurrent window analysis
  const windows: { windowIndex: number; startIdx: number; endIdx: number; spans: AtomicSpan[] }[] = [];
  for (let start = 0; start < input.spans.length; start += spansPerWindow - WINDOW_OVERLAP) {
    const end = Math.min(start + spansPerWindow, input.spans.length);
    windows.push({ windowIndex: windows.length, startIdx: start, endIdx: end - 1, spans: input.spans.slice(start, end) });
  }

  const concurrentSemaphore = 3;
  const windowAnalyses: Array<{ windowIndex: number; topics: string[]; boundaryIds: string[] }> = [];

  for (let batchStart = 0; batchStart < windows.length; batchStart += concurrentSemaphore) {
    const batch = windows.slice(batchStart, batchStart + concurrentSemaphore);
    const results = await Promise.allSettled(batch.map(async (win) => {
      const spanSummary = win.spans.map((s) => ({ id: s.id, preview: s.text.slice(0, 120).replace(/\n/g, " ") }));
      const prev = batchStart > 0 ? windowAnalyses[windowAnalyses.length - 1]?.topics.join(", ") : "";

      const prompt = `Analyze this document segment for topic identification.
${prev ? `Previous topics: ${prev}` : ""}

## Spans (${win.spans.length} spans, window ${win.windowIndex + 1}/${windows.length})
${JSON.stringify(spanSummary, null, 2)}

## Task
1. Identify main topics discussed
2. Mark spans where topic transitions occur
3. List key terms

Return ONLY a JSON object:
{ "topics": ["topic1", "topic2"], "boundaryIds": ["s_xxxx", "s_yyyy"], "keyTerms": ["term1", "term2"] }`;

      const response = await provider.chat({
        model: input.writingModel.modelId,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        maxTokens: 1024,
      });
      return extractWindowAnalysis(response.content, win.windowIndex);
    }));

    for (const result of results) {
      if (result.status === "fulfilled") windowAnalyses.push(result.value);
    }
  }

  const allTopics = windowAnalyses.flatMap((w) => w.topics);
  const allBoundaries = windowAnalyses.flatMap((w) => w.boundaryIds);

  // Phase B: global outline merge
  const spanSummary = input.spans.map((s) => ({ id: s.id, tokens: s.tokenCount }));
  const mergePrompt = `Merge these window-level analyses into a global document outline and segmentation plan.

## Document spans: ${spanSummary.length} total
## Total tokens: ${input.spans.reduce((sum, s) => sum + s.tokenCount, 0)}
## Safe segment limit: ${safeLimit} tokens

## Detected topics across windows:
${allTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## Detected boundaries:
${allBoundaries.join(", ")}

## Output Format
Return ONLY JSON:
{
  "segments": [
    { "title": "...", "startSpanId": "s_xxxx", "endSpanId": "s_yyyy", "estimatedTokens": N, "reason": "..." }
  ]
}
- Every span from ${input.spans[0]?.id} to ${input.spans[input.spans.length - 1]?.id} must be covered.
- Each segment must be <= ${safeLimit} tokens.`;

  const mergeResponse = await provider.chat({
    model: input.writingModel.modelId,
    messages: [{ role: "user", content: mergePrompt }],
    temperature: 0,
    maxTokens: 4096,
  });

  const parsed = parseOutlineResponse(mergeResponse.content, input.spans, safeLimit);
  if (parsed) return parsed;

  return fallbackAutoSegmentation(input.spans, safeLimit);
}

export async function induceDocumentOutline(
  input: OutlineInductionInput,
  testProvider?: LLMProvider,
): Promise<OutlineResult> {
  const provider = testProvider || (createLLMProvider(input.writingModel.provider) as unknown as LLMProvider);

  const totalTokens = input.spans.reduce((sum, s) => sum + s.tokenCount, 0);
  const useWindowed = input.spans.length >= LARGE_DOC_BOUNDARY || totalTokens >= SMALL_DOC_TOKEN_THRESHOLD;

  if (useWindowed) {
    return windowedOutline(input, provider);
  }
  return singlePassOutline(input, provider);
}

function extractWindowAnalysis(raw: string, windowIndex: number): { windowIndex: number; topics: string[]; boundaryIds: string[] } {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      windowIndex,
      topics: (parsed.topics || []) as string[],
      boundaryIds: (parsed.boundaryIds || []) as string[],
    };
  } catch {
    return { windowIndex, topics: [], boundaryIds: [] };
  }
}

function parseOutlineResponse(
  raw: string,
  spans: AtomicSpan[],
  safeLimit: number,
): OutlineResult | null {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const rawSegments: Array<{
      title: string;
      startSpanId: string;
      endSpanId: string;
      estimatedTokens: number;
      reason?: string;
    }> = parsed.segments || [];

    if (rawSegments.length === 0) return null;

    const spanIdx = new Map<string, number>();
    spans.forEach((s, i) => spanIdx.set(s.id, i));

    const segments: SegmentationSegment[] = [];
    for (const seg of rawSegments) {
      const startIdx = spanIdx.get(seg.startSpanId);
      const endIdx = spanIdx.get(seg.endSpanId);
      if (startIdx === undefined || endIdx === undefined || startIdx > endIdx) continue;

      const actualTokens = spans.slice(startIdx, endIdx + 1).reduce((sum, s) => sum + s.tokenCount, 0);
      segments.push({
        title: seg.title || `Segment ${segments.length + 1}`,
        startSpanId: seg.startSpanId,
        endSpanId: seg.endSpanId,
        estimatedTokens: Math.min(actualTokens, safeLimit),
        reason: seg.reason || "",
      });
    }

    if (segments.length === 0) return null;

    const outline: DocumentOutlineNode[] = (parsed.outline || []).map((o: { title: string; startSpanId: string; endSpanId: string; summary?: string }) => ({
      title: o.title || "",
      startSpanId: o.startSpanId || "",
      endSpanId: o.endSpanId || "",
      summary: o.summary || "",
    }));

    return { outline, segments };
  } catch {
    return null;
  }
}

function fallbackAutoSegmentation(spans: AtomicSpan[], maxTokens: number): OutlineResult {
  const segments: SegmentationSegment[] = [];
  let currentStart = 0;
  let currentTitle = "Section 1";
  let sectionCounter = 1;

  for (let i = 0; i < spans.length; i++) {
    if (spans[i].type === "heading" && i > currentStart) {
      const sectionTokens = spans.slice(currentStart, i).reduce((sum, s) => sum + s.tokenCount, 0);
      if (sectionTokens > 0) {
        segments.push({
          title: currentTitle,
          startSpanId: spans[currentStart].id,
          endSpanId: spans[i - 1].id,
          estimatedTokens: sectionTokens,
          reason: "Auto-segmented at heading boundary",
        });
      }
      currentStart = i;
      currentTitle = spans[i].text;
      sectionCounter++;
    }

    // Check if accumulated spans exceed limit
    const accumulatedTokens = spans.slice(currentStart, i + 1).reduce((sum, s) => sum + s.tokenCount, 0);
    if (accumulatedTokens >= maxTokens && i > currentStart) {
      segments.push({
        title: currentTitle,
        startSpanId: spans[currentStart].id,
        endSpanId: spans[i].id,
        estimatedTokens: accumulatedTokens,
        reason: "Auto-segmented at token limit",
      });
      currentStart = i + 1;
      if (currentStart < spans.length) {
        currentTitle = `Section ${sectionCounter}`;
        sectionCounter++;
      }
    }
  }

  const remaining = spans.slice(currentStart);
  if (remaining.length > 0) {
    const remainingTokens = remaining.reduce((sum, s) => sum + s.tokenCount, 0);
    // If remaining segment is too large, split into max-sized chunks
    if (remainingTokens > maxTokens) {
      let segStart = 0;
      while (segStart < remaining.length) {
        let segEnd = segStart;
        let segTokens = 0;
        while (segEnd < remaining.length && segTokens + remaining[segEnd].tokenCount <= maxTokens) {
          segTokens += remaining[segEnd].tokenCount;
          segEnd++;
        }
        if (segEnd === segStart) segEnd = segStart + 1; // at least one span
        const actualEnd = Math.min(segEnd, remaining.length) - 1;
        segments.push({
          title: currentTitle,
          startSpanId: remaining[segStart].id,
          endSpanId: remaining[actualEnd].id,
          estimatedTokens: segTokens || remaining[segStart].tokenCount,
          reason: "Auto-segmented: large section split by token limit",
        });
        segStart = segEnd;
      }
    } else {
      segments.push({
        title: currentTitle,
        startSpanId: remaining[0].id,
        endSpanId: remaining[remaining.length - 1].id,
        estimatedTokens: remainingTokens,
        reason: "Auto-segmented: final section",
      });
    }
  }

  if (segments.length === 0) {
    const allTokens = spans.reduce((sum, s) => sum + s.tokenCount, 0);
    segments.push({
      title: "Document",
      startSpanId: spans[0].id,
      endSpanId: spans[spans.length - 1].id,
      estimatedTokens: allTokens,
      reason: "Auto-segmented: single segment",
    });
  }

  return {
    outline: segments.map((s) => ({ title: s.title, startSpanId: s.startSpanId, endSpanId: s.endSpanId, summary: s.reason })),
    segments,
  };
}
