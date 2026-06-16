import { spawnPythonJson } from "@/lib/python";
import { isDaemonEnabled, pythonDaemon } from "@/lib/python-daemon";
import type { SplitChunk } from "@/lib/documents/splitter";
import type { MacroChunk } from "@/lib/documents/outline/macro-split";
import { splitSentences } from "@/lib/documents/outline/sentences";
import fs from "fs";
import path from "path";

const LOCAL_CHUNK_SCRIPT = "workers/python/local_chunk.py";
const BREADCRUMB_BUFFER = 80;
const TITLE_SNIPPET_MAX = 60;

/** Strip leading markdown heading lines (## ..., ### ...) from content. */
function stripLeadingHeadings(content: string): string {
  return content.replace(/^#{1,6}\s+[^\n]*\n?/gm, "").trim();
}

/**
 * Generate a content-aware chunk title.
 * headingPath provides structural context (e.g. "Introduction > Overview"),
 * and the first sentence of content provides topic specificity so every
 * sub-chunk from the same section gets a distinct, meaningful title.
 */
export function makeChunkTitle(headingPath: string, content: string): string {
  const prefix = headingPath || "Untitled";
  const clean = stripLeadingHeadings(content);
  if (!clean) return prefix;

  // Take the first sentence, capped at TITLE_SNIPPET_MAX chars
  const sentences = splitSentences(clean);
  const firstSentence = sentences[0] || "";
  const snippet = firstSentence.length > TITLE_SNIPPET_MAX
    ? firstSentence.slice(0, TITLE_SNIPPET_MAX).trimEnd() + "…"
    : firstSentence;

  if (!snippet || snippet.length < 10) return prefix;
  return `${prefix} — ${snippet}`;
}

/**
 * Greedily pack adjacent micro-split fragments into retrieval-sized chunks.
 * microSplitByLocalSemantic splits at every semantic boundary, so on
 * list/image-marker-heavy content (Docling emits one `<!-- image -->` per
 * picture and one line per list item) it produces hundreds of tiny one-item
 * chunks. Packing merges adjacent fragments that share a headingPath while
 * their combined token count stays under maxTokens, re-coalescing a section's
 * scattered items into coherent chunks. Section boundaries (headingPath
 * changes) are never crossed, and an already-oversized fragment is left alone
 * (enforceEmbeddingSafeChunks handles splitting those).
 */
export function packChunksBySize(chunks: SplitChunk[], maxTokens: number): SplitChunk[] {
  if (chunks.length <= 1) return chunks;

  const out: SplitChunk[] = [];
  let cur: SplitChunk | null = null;

  for (const c of chunks) {
    if (c.content.trim().length === 0) continue; // drop stray whitespace-only fragments
    if (!cur) {
      cur = { ...c };
      continue;
    }
    const sameSection = cur.headingPath === c.headingPath;
    const fits = cur.tokenCount + c.tokenCount <= maxTokens;
    if (sameSection && fits) {
      cur.content = `${cur.content}\n\n${c.content}`;
      cur.tokenCount = cur.tokenCount + c.tokenCount;
      cur.title = makeChunkTitle(cur.headingPath, cur.content);
    } else {
      out.push(cur);
      cur = { ...c };
    }
  }
  if (cur) out.push(cur);
  return out;
}

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

/**
 * Fallback path: one-shot spawn of local_chunk.py (the pre-daemon behavior).
 * Used when the daemon is disabled (PYTHON_DAEMON_ENABLED=false) or when a
 * daemon request fails (transparent self-healing fallback).
 */
async function chunkViaSpawn(params: {
  batches: { id: string; sentences: string[]; maxTokens: number }[];
  threshold: number;
}): Promise<{ results: MicroSplitBatchResult[] }> {
  const tempDir = path.join(process.env.TEMP || "/tmp", "synthetix-chunk");
  fs.mkdirSync(tempDir, { recursive: true });
  const inputFile = path.join(tempDir, `chunk-batch-${Date.now()}.json`);
  fs.writeFileSync(inputFile, JSON.stringify(params), "utf-8");
  try {
    return await spawnPythonJson<{ results: MicroSplitBatchResult[] }>(
      LOCAL_CHUNK_SCRIPT,
      ["--input-file", inputFile],
      { timeout: 120_000 },
    );
  } finally {
    fs.unlink(inputFile, () => {});
  }
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

  const chunkParams = {
    batches: batches.map((b) => ({ id: b.id, sentences: b.sentences, maxTokens: b.maxTokens })),
    threshold,
  };

  // Route through the resident daemon when enabled (skips ONNX cold-start);
  // transparently fall back to a one-shot spawn on any daemon failure so a
  // daemon hiccup never breaks document processing.
  let data: { results: MicroSplitBatchResult[] };
  if (isDaemonEnabled()) {
    try {
      data = await pythonDaemon.call<{ results: MicroSplitBatchResult[] }>(
        "chunk",
        chunkParams,
        { timeoutMs: 120_000 },
      );
    } catch (err) {
      console.warn("[daemon] chunk op failed, falling back to spawn:", err instanceof Error ? err.message : err);
      data = await chunkViaSpawn(chunkParams);
    }
  } else {
    data = await chunkViaSpawn(chunkParams);
  }

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
      // Even atomic/single-sentence chunks must be split if they exceed the max
      if (macro.tokenCount > safeMaxTokens) {
        const lines = macro.content.split("\n");
        let segLines: string[] = [];
        let segTokens = 0;
        for (const line of lines) {
          const lt = Math.max(1, line.length / 2);
          if (segTokens + lt > safeMaxTokens && segLines.length > 0) {
            const chunkContent = segLines.join("\n");
            chunks.push({
              index: chunkIdx++,
              title: makeChunkTitle(macro.headingPath, chunkContent),
              content: chunkContent,
              tokenCount: segTokens,
              headingPath: macro.headingPath,
            });
            segLines = [];
            segTokens = 0;
          }
          segLines.push(line);
          segTokens += lt;
        }
        if (segLines.length > 0) {
          const chunkContent = segLines.join("\n");
          chunks.push({
            index: chunkIdx++,
            title: makeChunkTitle(macro.headingPath, chunkContent),
            content: chunkContent,
            tokenCount: segTokens,
            headingPath: macro.headingPath,
          });
        }
      } else {
        chunks.push({
          index: chunkIdx++,
          title: makeChunkTitle(macro.headingPath, macro.content),
          content: macro.content,
          tokenCount: macro.tokenCount,
          headingPath: macro.headingPath,
        });
      }
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
        title: makeChunkTitle(macro.headingPath, content),
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
        title: makeChunkTitle(macro.headingPath, content),
        content,
        tokenCount: segSentences.reduce((sum, s) => sum + Math.max(1, s.length / 2), 0),
        headingPath: macro.headingPath,
      });
    }
  }

  // splitSentences() preserves blank lines as near-empty entries, so a segment
  // built from only blank lines (common around Docling code/table content that
  // heading-demoting consolidated into one macro chunk) joins to whitespace.
  // Drop those — they would become breadcrumb-only chunks that waste embeddings
  // and add retrieval noise. No real content is lost (blank lines carry none),
  // and chunk.index gaps are harmless (rewritten in splitAndPersistChunks).
  return chunks.filter((c) => c.content.trim().length > 0);
}
