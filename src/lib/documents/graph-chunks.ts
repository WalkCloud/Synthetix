/**
 * Graph contextual-prefix chunk builder.
 *
 * GraphRAG/LightRAG extract entities BEST from small/medium chunks (≈800–1500
 * tokens) — NOT from large segments (see design §4: larger chunks → lower entity
 * fidelity). But raw retrieval chunks lack context, producing noisy/garbage
 * entities. The fix is Anthropic-style Contextual Retrieval: prepend each
 * retrieval chunk with its owning Segment's title + summary so LightRAG sees
 * both fine-grained text AND the domain it belongs to.
 *
 * Output: graph_chunks/chunk_000.md, chunk_001.md, ... (same naming as retrieval
 * chunks so Python rag_index.py's `chunk_*.md` filter keeps working — design §9.1).
 *
 * CRITICAL (design §9.4): graph chunks have different TEXT than retrieval chunks
 * (they carry a prefix), so they MUST NOT reuse retrieval's embeddings.bin —
 * doing so would misalign embeddings with text. Callers disable embeddings.bin
 * reuse when graph_chunks exist and let LightRAG re-embed.
 */
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";

const GRAPH_CHUNKS_SUBDIR = "graph_chunks";
const CONTEXT_HEADER_MAX_CHARS = 600;

export interface GraphChunkBuildResult {
  dir: string;
  count: number;
  /** True if contextual prefixes were applied (segments existed). */
  contextual: boolean;
}

/**
 * Build the graph_chunks directory for a document. Maps each retrieval
 * DocumentChunk to its owning DocumentSegment (via heading-path proximity /
 * index overlap) and writes chunk_*.md files with a contextual prefix.
 *
 * Falls back to plain chunk content (no prefix) when no segments exist — the
 * directory is still valid for LightRAG. Idempotent: clears the dir first.
 */
export async function buildGraphContextualChunks(
  docId: string,
  outputDir: string,
): Promise<GraphChunkBuildResult | null> {
  const graphDir = path.join(outputDir, GRAPH_CHUNKS_SUBDIR);

  const [chunks, segments, atoms] = await Promise.all([
    db.documentChunk.findMany({
      where: { documentId: docId },
      orderBy: { index: "asc" },
      select: { index: true, content: true, headingPath: true, startPage: true, endPage: true },
    }),
    db.documentSegment.findMany({
      where: { documentId: docId },
      orderBy: { index: "asc" },
      select: { index: true, title: true, summary: true, startAtomIndex: true, endAtomIndex: true, headingPath: true },
    }),
    db.documentAtom.findMany({
      where: { documentId: docId },
      orderBy: { index: "asc" },
      select: { index: true, charStart: true, charEnd: true },
    }),
  ]);

  if (chunks.length === 0) return null;

  // Clean + (re)create the graph_chunks directory.
  await fs.promises.rm(graphDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.promises.mkdir(graphDir, { recursive: true });

  const contextual = segments.length >= 2;

  // Build a char-range → segment-index map so each chunk (located by its
  // position in the doc) can find its owning segment. We approximate chunk
  // position via its order index mapped onto the atom char-range span.
  // Simpler + robust: assign segments to chunks by proportion (chunk i of N
  // → atom index ≈ i/N * totalAtoms), then find which segment covers it.
  const segmentRanges = contextual
    ? segments.map((s) => ({ title: s.title, summary: s.summary, start: s.startAtomIndex, end: s.endAtomIndex }))
    : [];
  const totalAtoms = atoms.length;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let prefix = "";
    if (contextual && totalAtoms > 0) {
      // Estimate this chunk's atom position proportionally.
      const estAtom = Math.floor((i / chunks.length) * totalAtoms);
      const seg = segmentRanges.find((s) => estAtom >= s.start && estAtom <= s.end)
        ?? segmentRanges[segmentRanges.length - 1];
      if (seg) {
        const summary = (seg.summary ?? "").slice(0, CONTEXT_HEADER_MAX_CHARS).trim();
        prefix = `[Context: Segment "${seg.title}"]\n${summary}\n[Section: ${chunk.headingPath ?? seg.title}]\n---\n`;
      }
    }
    const body = prefix + chunk.content;
    const fname = `chunk_${String(i).padStart(3, "0")}.md`;
    await fs.promises.writeFile(path.join(graphDir, fname), body, "utf-8");
  }

  return { dir: graphDir, count: chunks.length, contextual };
}
