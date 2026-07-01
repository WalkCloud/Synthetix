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
import { loadProcessingTask, resolveProcessingModels } from "@/lib/documents/pipeline";
import { segmentAndPersistDocument } from "@/lib/documents/segmentation";
import { shouldEnqueueWikiSynthesis } from "./index-mode-flags";

export async function processDocumentSegment(
  taskId: string,
): Promise<{ ok: boolean; segment?: Awaited<ReturnType<typeof segmentAndPersistDocument>> }> {
  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 10 },
  });

  try {
    const ctx = await loadProcessingTask(taskId);
    await resolveProcessingModels(ctx);

    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 30 },
    });

    // Skip if the document was deleted while queued.
    const stillExists = await db.document.findUnique({
      where: { id: ctx.docId },
      select: { id: true },
    });
    if (!stillExists) {
      await db.asyncTask.update({
        where: { id: taskId },
        data: { status: "cancelled", errorMessage: "Document no longer exists", progress: 0 },
      });
      return { ok: false };
    }

    const result = await segmentAndPersistDocument(ctx);

    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        progress: 100,
        resultData: JSON.stringify(result),
      },
    });

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
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Document segmentation failed",
      },
    }).catch(() => undefined);

    // Segmentation failed — still submit wiki so it falls back to chunks.
    // Without this, a segmentation failure would skip wiki entirely.
    if (shouldEnqueueWikiSynthesis(ctx.options)) {
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
