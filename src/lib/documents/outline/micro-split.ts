import { spawnPythonJson } from "@/lib/python";
import type { SplitChunk } from "@/lib/documents/splitter";
import type { MacroChunk } from "@/lib/documents/outline/macro-split";
import { splitSentences } from "@/lib/documents/outline/sentences";

const LOCAL_CHUNK_SCRIPT = "workers/python/local_chunk.py";
const BREADCRUMB_BUFFER = 80;

interface MicroSplitBatchInput {
  id: string;
  sentences: string[];
  maxTokens: number;
}

interface MicroSplitBatchResult {
  id: string;
  similarities: number[];
  boundaries: number[];
}

export async function microSplitByLocalSemantic(
  macroChunks: MacroChunk[],
  maxTokens: number,
  threshold = 0.55,
): Promise<SplitChunk[]> {
  const safeMaxTokens = maxTokens - BREADCRUMB_BUFFER;

  // Collect all over-limit chunks for one batch call
  const batches: (MicroSplitBatchInput & { macro: MacroChunk })[] = [];

  for (let i = 0; i < macroChunks.length; i++) {
    const macro = macroChunks[i];
    if (macro.isAtomic) {
      // Atomic blocks don't get micro-split
      continue;
    }
    if (macro.tokenCount <= safeMaxTokens) {
      continue; // Small enough, no splitting needed
    }
    const sentences = splitSentences(macro.content);
    if (sentences.length <= 1) continue; // Can't split single sentence
    batches.push({
      id: `seg_${i}`,
      sentences,
      maxTokens: safeMaxTokens,
      macro,
    });
  }

  if (batches.length === 0) {
    // All macros fit within limit — return as-is
    return macroChunks.map((m, idx) => ({
      index: idx,
      title: m.headingPath || "Untitled",
      content: m.content,
      tokenCount: m.tokenCount,
      headingPath: m.headingPath,
    }));
  }

  const data = await spawnPythonJson<{ results: MicroSplitBatchResult[] }>(
    LOCAL_CHUNK_SCRIPT,
    [],
    { input: JSON.stringify({ batches: batches.map((b) => ({ id: b.id, sentences: b.sentences, maxTokens: b.maxTokens })), threshold }) },
  );

  // Build result map: seg_id → boundaries
  const boundaryMap = new Map<string, number[]>();
  for (const r of data.results) {
    boundaryMap.set(r.id, r.boundaries);
  }

  // Assemble final chunks
  const chunks: SplitChunk[] = [];
  let chunkIdx = 0;

  for (let i = 0; i < macroChunks.length; i++) {
    const macro = macroChunks[i];
    const boundaries = boundaryMap.get(`seg_${i}`);

    if (!boundaries || boundaries.length === 0) {
      // No splitting needed or atomic
      chunks.push({
        index: chunkIdx++,
        title: macro.headingPath || "Untitled",
        content: macro.content,
        tokenCount: macro.tokenCount,
        headingPath: macro.headingPath,
      });
      continue;
    }

    const sentences = splitSentences(macro.content);

    let segStart = 0;
    for (const boundary of boundaries) {
      if (boundary <= segStart) continue;
      const segSentences = sentences.slice(segStart, boundary);
      const content = segSentences.join("");
      chunks.push({
        index: chunkIdx++,
        title: macro.headingPath || "Untitled",
        content,
        tokenCount: segSentences.reduce((sum, s) => sum + Math.max(1, s.length / 2), 0),
        headingPath: macro.headingPath,
      });
      segStart = boundary;
    }

    // Remaining sentences after last boundary
    if (segStart < sentences.length) {
      const segSentences = sentences.slice(segStart);
      const content = segSentences.join("");
      chunks.push({
        index: chunkIdx++,
        title: macro.headingPath || "Untitled",
        content,
        tokenCount: segSentences.reduce((sum, s) => sum + Math.max(1, s.length / 2), 0),
        headingPath: macro.headingPath,
      });
    }
  }

  return chunks;
}
