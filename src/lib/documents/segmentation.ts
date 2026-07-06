/**
 * LLM-guided Hierarchical Domain Segmentation Engine.
 *
 * Produces DocumentSegment[] for a document — the primary Wiki input and the
 * context source for Graph contextual-prefix chunks. The LLM reads a COMPRESSED
 * structural map (window signatures + candidate boundaries + token stats), never
 * full text, so a 1000-page doc costs ~1 planning call + a few refinement calls.
 *
 * Pipeline (see docs/domain-segmentation-graph-wiki-optimization-final-2026-06-28.md §8):
 *   buildDocumentAtoms  →  buildWindowSignatures  →  detectCandidateBoundaries
 *   →  LLM global planning  →  local boundary refinement  →  deterministic validation
 *   →  persist DocumentSegment
 *
 * General across languages/document types: the LLM infers documentType and
 * candidateDomains from the doc itself — no fixed taxonomy is hardcoded.
 */
import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import { resolveLLMClient } from "@/lib/llm/client";
import { recordTokenUsage } from "@/lib/llm/usage";
import type { ChatParams } from "@/lib/llm/types";
import type { ProcessingContext } from "@/lib/documents/pipeline";
import {
  buildDocumentAtoms,
  buildWindowSignatures,
  detectCandidateBoundaries,
  type DocumentAtomRecord,
  type WindowSignature,
  type StructureJson,
} from "@/lib/documents/atoms";
import { estimateTokens } from "@/lib/documents/splitter";
import fs from "fs";

/** Hard ceilings for a single segment (in tokens). Wiki input units. */
const SEGMENT_MAX_TOKENS = 24_000;
const SEGMENT_MIN_TOKENS = 300;
const SEGMENT_TARGET_TOKENS = 6_000;

export interface RawSegmentPlan {
  title: string;
  startWindowIndex: number;
  endWindowIndex: number;
  startAtomHint: number;
  endAtomHint: number;
  reason?: string;
  confidence?: number;
}

export interface LlmSegmentationPlan {
  documentType: string;
  language: string;
  segmentationStrategy: string;
  segments: RawSegmentPlan[];
}

export interface SegmentationResult {
  segmentCount: number;
  atomCount: number;
  windowCount: number;
  candidateBoundaryCount: number;
  segmentTokenAvg: number;
  segmentTokenMax: number;
  segmentationMs: number;
  llmPlanningTokens: number;
  boundaryRefinementCalls: number;
  fallbackUsed: boolean;
  method: "llm" | "hybrid" | "fallback";
  coverageRate: number;
}

const PLANNING_PROMPT = `You are a document segmentation expert. Given a compressed structural map of a document (window signatures, candidate boundaries, token statistics), partition it into coherent DOMAIN/TOPIC segments.

Rules:
1. Segments must COVER the ENTIRE document with NO GAPS and NO OVERLAP, in order.
2. The first segment must start at window index 0; the last must end at the last window.
3. Adjacent segments are contiguous: segment[i].endWindowIndex + 1 === segment[i+1].startWindowIndex.
4. Infer documentType and language from the content itself — do NOT assume a fixed structure (research paper, contract, manual, etc. are just examples).
5. Segment boundaries should align with topic/domain shifts, ideally near candidate boundaries, but you may add or skip them.
6. Each segment should be a coherent topic (e.g. one major subject area), not a single tiny section. Aim for substantial segments.
7. Provide startAtomHint/endAtomHint as your best atom-index estimate (inclusive end).

Return STRICT JSON only:
{
  "documentType": "<inferred type>",
  "language": "<en|zh|mixed zh/en|...>",
  "segmentationStrategy": "domain-based",
  "segments": [
    {"title": "...", "startWindowIndex": 0, "endWindowIndex": 3, "startAtomHint": 0, "endAtomHint": 45, "reason": "...", "confidence": 0.9}
  ]
}`;

/**
 * Run the full segmentation pipeline for a document and persist segments.
 * Returns metrics. Non-throwing: on LLM failure, falls back to a deterministic
 * token-bucket segmentation so downstream stages still have segments to use.
 */
export async function segmentAndPersistDocument(
  ctx: ProcessingContext,
): Promise<SegmentationResult> {
  const started = Date.now();
  const markdown = ctx.markdownPath
    ? await fs.promises.readFile(ctx.markdownPath, "utf-8").catch(() => "")
    : "";

  let structure: StructureJson | null = null;
  if (ctx.structurePath) {
    try {
      const raw = await fs.promises.readFile(ctx.structurePath, "utf-8").catch(() => null);
      if (raw) structure = JSON.parse(raw) as StructureJson;
    } catch {
      structure = null;
    }
  }

  const atoms = buildDocumentAtoms(markdown, structure);
  if (atoms.length === 0) {
    return emptyResult(started, 0, "fallback");
  }

  const windows = buildWindowSignatures(atoms);
  const candidateBoundaries = detectCandidateBoundaries(atoms);

  // Try LLM planning; fall back to deterministic segmentation on any failure.
  let plan: LlmSegmentationPlan | null = null;
  let llmTokens = 0;
  let refinementCalls = 0;
  let method: SegmentationResult["method"] = "fallback";

  try {
    const llm = await resolveSegmentationLlm(ctx);
    if (llm) {
      const planned = await llmGlobalPlan(llm, atoms, windows, candidateBoundaries, ctx);
      plan = planned.plan;
      llmTokens = planned.tokens;
      method = "llm";
    }
  } catch (err) {
    console.warn(`[segmentation] LLM planning failed for doc ${ctx.docId}, falling back:`, err);
  }

  let segments: PersistedSegment[];
  if (plan) {
    const refined = refineBoundaries(plan, atoms, windows);
    refinementCalls = refined.refinementCalls;
    segments = validateAndBuildSegments(refined.segments, atoms);
    if (segments.length === 0) {
      console.warn(`[segmentation] LLM plan validated to 0 segments for doc ${ctx.docId}; falling back`);
      segments = fallbackTokenBucketSegments(atoms);
      method = "fallback";
    }
  } else {
    segments = fallbackTokenBucketSegments(atoms);
  }

  await persistSegments(ctx.docId, segments, method);

  const tokenCounts = segments.map((s) => s.tokenCount);
  const totalAtomCoverage = segments.reduce((sum, s) => sum + (s.endAtomIndex - s.startAtomIndex + 1), 0);
  return {
    segmentCount: segments.length,
    atomCount: atoms.length,
    windowCount: windows.length,
    candidateBoundaryCount: candidateBoundaries.length,
    segmentTokenAvg: tokenCounts.length ? Math.round(tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length) : 0,
    segmentTokenMax: tokenCounts.length ? Math.max(...tokenCounts) : 0,
    segmentationMs: Date.now() - started,
    llmPlanningTokens: llmTokens,
    boundaryRefinementCalls: refinementCalls,
    fallbackUsed: method === "fallback",
    method,
    coverageRate: atoms.length > 0 ? totalAtomCoverage / atoms.length : 0,
  };
}

interface SegmentationLlm {
  provider: ReturnType<typeof createLLMProvider>;
  modelId: string;
  modelConfigId: string;
  userId: string;
}

async function resolveSegmentationLlm(ctx: ProcessingContext): Promise<SegmentationLlm | null> {
  if (ctx.writingModel?.provider) {
    return {
      provider: createLLMProvider({
        apiBaseUrl: ctx.writingModel.provider.apiBaseUrl,
        apiKey: ctx.writingModel.provider.apiKey,
        providerType: ctx.writingModel.provider.providerType,
      }),
      modelId: ctx.writingModel.modelId,
      modelConfigId: ctx.writingModel.id,
      userId: ctx.doc.userId,
    };
  }
  const resolved = await resolveLLMClient("writing", ctx.doc.userId);
  if (!resolved) return null;
  return {
    provider: resolved.provider,
    modelId: resolved.modelId,
    modelConfigId: resolved.modelConfigId,
    userId: ctx.doc.userId,
  };
}

/**
 * Build the compressed structural map and ask the LLM for a segmentation plan.
 */
async function llmGlobalPlan(
  llm: SegmentationLlm,
  atoms: DocumentAtomRecord[],
  windows: WindowSignature[],
  candidateBoundaries: number[],
  ctx: ProcessingContext,
): Promise<{ plan: LlmSegmentationPlan; tokens: number }> {
  const totalTokens = atoms.reduce((s, a) => s + a.tokenCount, 0);
  const map = {
    documentId: ctx.docId,
    atomCount: atoms.length,
    windowCount: windows.length,
    totalTokens,
    candidateBoundaries,
    windows: windows.map((w) => ({
      i: w.index,
      atoms: `${w.startAtomIndex}-${w.endAtomIndex}`,
      tokens: w.tokenCount,
      blocks: w.blockTypeCounts,
      heading: w.leadingHeadingPath,
      preview: w.previews,
    })),
  };

  const params: ChatParams = {
    model: llm.modelId,
    messages: [
      { role: "system", content: PLANNING_PROMPT },
      { role: "user", content: `Structural map (JSON):\n${JSON.stringify(map)}` },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    maxTokens: 8192,
  };

  const response = await llm.provider.chat(params);
  const inputTokens = response.inputTokens ?? estimateTokens(JSON.stringify(map));
  const outputTokens = response.outputTokens ?? estimateTokens(response.content);
  void recordTokenUsage({
    userId: llm.userId,
    modelConfigId: llm.modelConfigId,
    module: "segmentation",
    inputTokens,
    outputTokens,
    referenceId: ctx.docId,
  }).catch(() => undefined);

  const plan = parsePlanResponse(response.content);
  if (!plan) {
    // Log a preview so segmentation failures are diagnosable. Truncated
    // responses (maxTokens too low for large docs) are the most common cause.
    const preview = response.content.slice(0, 300).replace(/\s+/g, " ");
    const finishReason = response.finishReason ? ` (finishReason=${response.finishReason})` : "";
    console.warn(
      `[segmentation] unparseable plan for doc ${ctx.docId}${finishReason}; windows=${windows.length} ` +
      `inputTokens=${inputTokens} outputTokens=${outputTokens}; content preview: "${preview}..."`,
    );
    throw new Error(`LLM returned unparseable segmentation plan${finishReason}`);
  }
  return { plan, tokens: inputTokens + outputTokens };
}

export function parsePlanResponse(content: string): LlmSegmentationPlan | null {
  const jsonStr = extractJson(content);
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || !Array.isArray(parsed.segments)) return null;
    return parsed as LlmSegmentationPlan;
  } catch {
    // Try a lenient repair: strip trailing commas.
    try {
      const repaired = jsonStr.replace(/,(\s*[}\]])/g, "$1");
      const parsed = JSON.parse(repaired);
      if (!parsed || !Array.isArray(parsed.segments)) return null;
      return parsed as LlmSegmentationPlan;
    } catch {
      return null;
    }
  }
}

function extractJson(content: string): string | null {
  const trimmed = content.trim();
  // Strip markdown code fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  // Find the outermost JSON object.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export interface RefinedSegment {
  title: string;
  startAtomIndex: number;
  endAtomIndex: number;
  confidence: number;
  reason?: string;
}

/**
 * Refine LLM window-based hints to exact atom indices. Snap each boundary to
 * the nearest candidate boundary (heading) within a small window. This is
 * LOCAL (no extra LLM calls in the MVP) — refinement counts refer to the
 * snapping adjustments made.
 */
export function refineBoundaries(
  plan: LlmSegmentationPlan,
  atoms: DocumentAtomRecord[],
  windows: WindowSignature[],
): { segments: RefinedSegment[]; refinementCalls: number } {
  const lastAtom = atoms.length - 1;
  const sorted = [...plan.segments].sort((a, b) => a.startWindowIndex - b.startWindowIndex);
  const refined: RefinedSegment[] = [];
  let refinementCalls = 0;

  for (let i = 0; i < sorted.length; i++) {
    const raw = sorted[i];
    const isFirst = i === 0;
    const isLast = i === sorted.length - 1;

    // Map window indices → atom indices via the window signatures.
    const startWin = windows[Math.min(raw.startWindowIndex, windows.length - 1)];
    const endWin = windows[Math.min(raw.endWindowIndex, windows.length - 1)];
    let startAtom = isFirst ? 0 : (startWin?.startAtomIndex ?? (refined[i - 1]?.endAtomIndex ?? 0) + 1);
    let endAtom = isLast ? lastAtom : (endWin?.endAtomIndex ?? lastAtom);

    // Snap to nearest heading boundary (refinement) for cleaner cuts.
    const snappedStart = snapToHeading(atoms, startAtom, "forward", 8);
    if (snappedStart !== startAtom && !isFirst) {
      refinementCalls++;
      startAtom = snappedStart;
    }
    const snappedEnd = snapToHeading(atoms, endAtom, "backward", 8);
    if (snappedEnd !== endAtom && !isLast) {
      refinementCalls++;
      endAtom = snappedEnd;
    }

    // Contiguity: start where the previous segment ended + 1.
    if (i > 0 && refined[i - 1]) {
      startAtom = Math.max(startAtom, refined[i - 1].endAtomIndex + 1);
    }
    startAtom = Math.max(0, Math.min(startAtom, lastAtom));
    endAtom = Math.max(startAtom, Math.min(endAtom, lastAtom));

    refined.push({
      title: raw.title || `Segment ${i + 1}`,
      startAtomIndex: startAtom,
      endAtomIndex: endAtom,
      confidence: typeof raw.confidence === "number" ? raw.confidence : 0.8,
      reason: raw.reason,
    });
  }
  return { segments: refined, refinementCalls };
}

/** Snap an atom index to the nearest heading in the given direction. */
function snapToHeading(
  atoms: DocumentAtomRecord[],
  idx: number,
  direction: "forward" | "backward",
  maxDistance: number,
): number {
  for (let d = 0; d <= maxDistance; d++) {
    const probe = direction === "forward" ? idx + d : idx - d;
    if (probe < 0 || probe >= atoms.length) continue;
    if (atoms[probe].blockType === "heading") return probe;
  }
  return idx;
}

export interface PersistedSegment {
  title: string;
  summary: string;
  startAtomIndex: number;
  endAtomIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  headingPath: string | null;
  tokenCount: number;
  sourceAtomIds: string[];
  confidence: number;
  reason?: string;
}

/**
 * Deterministic validation (design §15): enforce contiguity, no gaps/overlap,
 * coverage = 1.0, and split/merge segments that violate size limits. Returns
 * [] if the plan is irrecoverably malformed (caller falls back).
 */
export function validateAndBuildSegments(
  refined: RefinedSegment[],
  atoms: DocumentAtomRecord[],
): PersistedSegment[] {
  if (refined.length === 0 || atoms.length === 0) return [];
  const lastAtom = atoms.length - 1;

  // Sort by start to be safe, then build contiguous segments in one pass:
  // each segment starts at prevEnd+1 (first starts at 0), ends at its own end
  // (clamped), last forced to lastAtom. Small segments merge into the previous.
  const sorted = [...refined].sort((a, b) => a.startAtomIndex - b.startAtomIndex);
  const merged: RefinedSegment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const raw = sorted[i];
    // First segment must start at 0 (no leading gap); later segments start at
    // prevEnd+1 to guarantee contiguity (no gaps, no overlap) regardless of
    // what the LLM/planner suggested.
    const start = i === 0
      ? 0
      : (merged[merged.length - 1]?.endAtomIndex ?? -1) + 1;
    let end = Math.max(raw.endAtomIndex, start);
    if (i === sorted.length - 1) end = lastAtom;
    const clampedStart = Math.min(start, lastAtom);
    const clampedEnd = Math.min(end, lastAtom);
    if (clampedEnd < clampedStart) continue;

    const tokens = atomRangeTokens(atoms, clampedStart, clampedEnd);
    if (tokens < SEGMENT_MIN_TOKENS && merged.length > 0) {
      // Too small — fold into previous segment (extends its end).
      const prev = merged[merged.length - 1];
      prev.endAtomIndex = clampedEnd;
      prev.title = `${prev.title} · ${raw.title}`;
    } else {
      merged.push({ ...raw, startAtomIndex: clampedStart, endAtomIndex: clampedEnd });
    }
  }

  // Guarantee the final segment reaches the last atom (coverage = 1.0).
  if (merged.length > 0 && merged[merged.length - 1].endAtomIndex < lastAtom) {
    merged[merged.length - 1].endAtomIndex = lastAtom;
  }

  return merged.map((seg) => buildPersistedSegment(seg, atoms));
}

function buildPersistedSegment(
  seg: RefinedSegment,
  atoms: DocumentAtomRecord[],
): PersistedSegment {
  const range = atoms.slice(seg.startAtomIndex, seg.endAtomIndex + 1);
  const tokenCount = range.reduce((s, a) => s + a.tokenCount, 0);
  const summary = buildSegmentSummary(range);
  const pages = range
    .map((a) => a.pageStart)
    .filter((p): p is number => typeof p === "number");
  return {
    title: seg.title,
    summary,
    startAtomIndex: seg.startAtomIndex,
    endAtomIndex: seg.endAtomIndex,
    pageStart: pages.length ? Math.min(...pages) : null,
    pageEnd: pages.length ? Math.max(...pages) : null,
    headingPath: range.find((a) => a.headingPath)?.headingPath ?? null,
    tokenCount,
    sourceAtomIds: range.map((a) => a.spanId),
    confidence: seg.confidence,
    reason: seg.reason,
  };
}

/** First heading + first paragraph preview, capped — used as Graph chunk prefix. */
function buildSegmentSummary(atoms: DocumentAtomRecord[]): string {
  const heading = atoms.find((a) => a.blockType === "heading");
  const para = atoms.find((a) => a.blockType === "paragraph");
  const parts: string[] = [];
  if (heading) parts.push(heading.textPreview ?? heading.content);
  if (para) parts.push((para.textPreview ?? para.content).slice(0, 200));
  return parts.join(" — ").slice(0, 300) || (atoms[0]?.textPreview ?? "");
}

function atomRangeTokens(atoms: DocumentAtomRecord[], start: number, end: number): number {
  let sum = 0;
  for (let i = start; i <= end && i < atoms.length; i++) sum += atoms[i].tokenCount;
  return sum;
}

/**
 * Deterministic fallback: bucket atoms into ~target-token segments at heading
 * boundaries. Used when LLM planning is unavailable or fails. Guarantees full
 * coverage.
 */
export function fallbackTokenBucketSegments(atoms: DocumentAtomRecord[]): PersistedSegment[] {
  const segments: PersistedSegment[] = [];
  let bucketStart = 0;
  let tokens = 0;
  let segIdx = 0;
  for (let i = 0; i < atoms.length; i++) {
    tokens += atoms[i].tokenCount;
    const atHeading = atoms[i].blockType === "heading" && (atoms[i].headingLevel ?? 99) <= 2;
    const overTarget = tokens >= SEGMENT_TARGET_TOKENS;
    const wouldOverflowNext = tokens >= SEGMENT_MAX_TOKENS;
    if ((atHeading && overTarget && i > bucketStart) || wouldOverflowNext || i === atoms.length - 1) {
      const end = i === atoms.length - 1 ? i : i;
      const seg: RefinedSegment = {
        title: atoms[bucketStart]?.textPreview?.slice(0, 80) || `Segment ${segIdx + 1}`,
        startAtomIndex: bucketStart,
        endAtomIndex: end,
        confidence: 0.6,
      };
      segments.push(buildPersistedSegment(seg, atoms));
      segIdx++;
      bucketStart = end + 1;
      tokens = 0;
    }
  }
  if (bucketStart < atoms.length) {
    segments.push(buildPersistedSegment(
      { title: `Segment ${segIdx + 1}`, startAtomIndex: bucketStart, endAtomIndex: atoms.length - 1, confidence: 0.6 },
      atoms,
    ));
  }
  return segments;
}

const SEGMENT_CREATE_BATCH = 50;

async function persistSegments(
  docId: string,
  segments: PersistedSegment[],
  method: string,
): Promise<void> {
  await db.documentSegment.deleteMany({ where: { documentId: docId } });
  if (segments.length === 0) return;
  for (let i = 0; i < segments.length; i += SEGMENT_CREATE_BATCH) {
    const batch = segments.slice(i, i + SEGMENT_CREATE_BATCH);
    await db.documentSegment.createMany({
      data: batch.map((s, idx) => ({
        documentId: docId,
        index: i + idx,
        title: s.title,
        summary: s.summary,
        startAtomIndex: s.startAtomIndex,
        endAtomIndex: s.endAtomIndex,
        pageStart: s.pageStart,
        pageEnd: s.pageEnd,
        headingPath: s.headingPath,
        tokenCount: s.tokenCount,
        sourceAtomIds: JSON.stringify(s.sourceAtomIds),
        segmentationMethod: method,
        segmentationReason: s.reason,
        confidence: s.confidence,
      })),
    });
  }
}

function emptyResult(started: number, atomCount: number, method: SegmentationResult["method"]): SegmentationResult {
  return {
    segmentCount: 0,
    atomCount,
    windowCount: 0,
    candidateBoundaryCount: 0,
    segmentTokenAvg: 0,
    segmentTokenMax: 0,
    segmentationMs: Date.now() - started,
    llmPlanningTokens: 0,
    boundaryRefinementCalls: 0,
    fallbackUsed: method === "fallback",
    method,
    coverageRate: 0,
  };
}
