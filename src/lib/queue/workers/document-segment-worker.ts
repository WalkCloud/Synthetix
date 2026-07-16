/**
 * document_segment worker — LLM-guided domain segmentation.
 *
 * Produces DocumentSegment[] for a document (the Wiki primary input and the
 * Graph contextual-prefix source). On success, it submits wiki_synthesize so
 * that wiki reads the freshly-persisted segments (9 large, coherent units) —
 * not the 40 raw chunks that caused fragmentation. On segmentation failure,
 * it still submits wiki (which falls back to chunks) so wiki is never skipped.
 *
 * Design: docs/domain-segmentation-graph-wiki-optimization-final-2026-06-28.md §8, §11
 * Non-blocking on document readiness — by the time this runs the document is
 * already `ready` (basic retrieval usable). A segmentation failure just leaves
 * the doc operating on chunks (the pre-segmentation behaviour).
 */
import { db } from "@/lib/db";
import { loadProcessingTask, resolveProcessingModels, type ProcessingContext } from "@/lib/documents/pipeline";
import { segmentAndPersistDocument } from "@/lib/documents/segmentation";
import { shouldEnqueueWikiSynthesis } from "./index-mode-flags";
import { cancelledOutcome, type WorkerResult } from "@/lib/queue/types";

export async function processDocumentSegment(
  taskId: string,
): Promise<WorkerResult> {
  // Declared outside try so the catch block can access it for the wiki
  // fallback submission. When loadProcessingTask itself throws, ctx is null
  // and we skip the wiki fallback (there's no docId to submit for).
  let ctx: ProcessingContext | null = null;

  try {
    ctx = await loadProcessingTask(taskId);
    await resolveProcessingModels(ctx);

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 30 },
    });

    // Skip if the document was deleted while queued.
    const stillExists = await db.document.findUnique({
      where: { id: ctx.docId },
      select: { id: true },
    });
    if (!stillExists) {
      return cancelledOutcome("Document no longer exists", { ok: false }, 0);
    }

    const result = await segmentAndPersistDocument(ctx);

    console.log(
      `[segment] doc ${ctx.docId}: ${result.segmentCount} segments from ${result.atomCount} atoms ` +
      `(${result.method}, coverage=${result.coverageRate.toFixed(2)}, ${result.segmentationMs}ms)`,
    );

    // ── Submit wiki_synthesize NOW that segments are persisted ──────────────
    // Segments exist in the DB, so wiki-synthesize-worker's `segments.length >= 2`
    // check passes and it processes the 9 large, coherent segments instead of
    // the 40 raw chunks. This is the key anti-fragmentation change.
    if (shouldEnqueueWikiSynthesis(ctx.options)) {
      try {
        const { getQueue } = await import("@/lib/queue");
        await getQueue().submit("wiki_synthesize", { docId: ctx.docId, options: ctx.options }, ctx.doc.userId);
        console.log(`[segment] doc ${ctx.docId}: submitted wiki_synthesize (using ${result.segmentCount} segments)`);
      } catch (wikiSubmitErr) {
        // Wiki submission failure must not invalidate the segmentation result.
        console.warn(`[segment] doc ${ctx.docId}: failed to submit wiki_synthesize:`, wikiSubmitErr);
      }
    }

    return { ok: true, segment: result };
  } catch (error) {
    // Segmentation failed — still submit wiki so it falls back to chunks.
    // Without this, a segmentation failure would skip wiki entirely.
    // Guard: if ctx itself failed to load (loadProcessingTask threw),
    // there's no docId to submit for, so skip the wiki fallback.
    if (ctx && shouldEnqueueWikiSynthesis(ctx.options)) {
      try {
        const { getQueue } = await import("@/lib/queue");
        await getQueue().submit("wiki_synthesize", { docId: ctx.docId, options: ctx.options }, ctx.doc.userId);
        console.log(`[segment] doc ${ctx.docId}: segmentation failed, submitted wiki_synthesize (chunk fallback)`);
      } catch (wikiSubmitErr) {
        console.warn(`[segment] doc ${ctx.docId}: failed to submit wiki_synthesize after seg failure:`, wikiSubmitErr);
      }
    }

    // Non-blocking: the document stays usable via chunks. Re-throw so the queue
    // records the failure, but the document is already ready.
    throw error;
  }
}
