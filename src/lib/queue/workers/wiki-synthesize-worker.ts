/**
 * Wiki synthesis worker — the async pipeline phase that precipitates
 * synthesized knowledge entries after a document is indexed.
 *
 * Mirrors the rag-embed-index-worker structure: loads ProcessingContext,
 * resolves the writing model, reads the document's chunks from the DB
 * (NOT full markdown — this is what keeps the LLM context-bounded), and
 * invokes the synthesizer. Non-blocking on document readiness — the
 * document is already `ready` by the time this runs.
 */

import { db } from "@/lib/db";
import { loadProcessingTask, resolveProcessingModels } from "@/lib/documents/pipeline";
import { synthesizeDocument, type SynthChunk } from "@/lib/wiki/synthesizer";
import { failedOutcome, type WorkerResult, type TaskExecutionContext } from "@/lib/queue/types";

export async function processWikiSynthesize(
  taskId: string,
  _ctx: TaskExecutionContext,
): Promise<WorkerResult> {
  let docId: string | undefined;

  try {
    const ctx = await loadProcessingTask(taskId);
    docId = ctx.docId;

    // Resolve the writing LLM (same pattern as rag-embed-index-worker +
    // auto-tagger). Without a writing model we skip gracefully.
    await resolveProcessingModels(ctx);

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 30 },
    });

    // ── Input unit selection: prefer DocumentSegments, fall back to chunks ──
    // Segments are LLM-induced domain units with larger, coherent context —
    // the Wiki's preferred input (better quality, less fragmentation). Wiki is
    // submitted in parallel with document_segment, so segments may not exist
    // yet on the first run; in that case we use chunks (the pre-segmentation
    // behaviour). This keeps Wiki non-blocking on segmentation.
    const segments = await db.documentSegment.findMany({
      where: { documentId: ctx.docId },
      orderBy: { index: "asc" },
    });

    let synthChunks: SynthChunk[];
    let inputUnitType: "segment" | "chunk";

    if (segments.length >= 2) {
      // Reconstruct each segment's text from its atom range for full context.
      const atoms = await db.documentAtom.findMany({
        where: { documentId: ctx.docId },
        orderBy: { index: "asc" },
        select: { index: true, content: true },
      });
      const atomByIndex = new Map(atoms.map((a) => [a.index, a.content]));
      synthChunks = segments.map((seg) => {
        const parts: string[] = [];
        for (let i = seg.startAtomIndex; i <= seg.endAtomIndex; i++) {
          const text = atomByIndex.get(i);
          if (text) parts.push(text);
        }
        const content = parts.join("\n\n");
        return {
          id: seg.id,
          index: seg.index,
          content,
          tokenCount: seg.tokenCount ?? undefined,
          title: seg.title,
        };
      });
      inputUnitType = "segment";
      console.log(`[wiki] doc ${ctx.docId}: using ${synthChunks.length} segments as input (vs ${await db.documentChunk.count({ where: { documentId: ctx.docId } }).catch(() => 0)} chunks)`);
    } else {
      // Fallback: load chunks from the DB — NOT the full markdown. This keeps
      // the LLM context-bounded: the synthesizer processes one unit at a time
      // regardless of total document size.
      const chunks = await db.documentChunk.findMany({
        where: { documentId: ctx.docId },
        orderBy: { index: "asc" },
        select: { id: true, index: true, content: true, tokenCount: true, title: true },
      });

      if (chunks.length === 0) {
        return {
          ok: true,
          reason: "no chunks",
          wiki: {
            entriesCreated: 0,
            entriesUpdated: 0,
            docSummaryCreated: false,
            chunksProcessed: 0,
            chunksTotal: 0,
            completed: true,
          },
        };
      }

      synthChunks = chunks.map((c) => ({
        id: c.id,
        index: c.index,
        content: c.content,
        tokenCount: c.tokenCount,
        title: c.title,
      }));
      inputUnitType = "chunk";
    }

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 50 },
    });

    const result = await synthesizeDocument(ctx, synthChunks, inputUnitType, (processed, total, phase = "extract") => {
      const frac = total > 0 ? processed / total : 0;
      const [floor, ceil] = phase === "merge" ? [65, 88] : phase === "summary" ? [88, 98] : [30, 65];
      const pct = Math.round(floor + frac * (ceil - floor));
      // Fire-and-forget: never let a progress write block or fail the task.
      db.asyncTask.updateMany({
        where: { id: taskId, status: "running" },
        data: { progress: pct },
      }).catch(() => {});
    });

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 98 },
    });

    const resultData = {
      inputUnitType,
      inputUnitCount: synthChunks.length,
      entriesCreated: result.entriesCreated,
      entriesUpdated: result.entriesUpdated,
      docSummaryCreated: result.docSummaryCreated,
      chunksProcessed: result.chunksProcessed,
      chunksTotal: result.chunksTotal,
      chunksFailed: result.chunksFailed,
      failedUnitIds: result.failedUnitIds,
      extractionMs: result.extractionMs,
      mergeMs: result.mergeMs,
      summaryMs: result.summaryMs,
      fusionCalls: result.fusionCalls,
      completed: result.completed,
    };

    if (!result.completed) {
      return failedOutcome("Wiki synthesis did not complete", resultData);
    }

    return resultData;
  } catch (error) {
    if (docId) {
      // Wiki failure does NOT mark the document as failed — it is already
      // `ready`. We only record the task failure for diagnostics.
    }
    // Re-throw so the queue records the failure, but the document stays ready
    throw error;
  }
}
