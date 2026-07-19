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
import { cancelledOutcome, type WorkerResult, type TaskExecutionContext } from "@/lib/queue/types";

export async function processDocumentSegment(
  taskId: string,
  taskCtx: TaskExecutionContext,
): Promise<WorkerResult> {
  // Declared outside try so the catch block can access it for the wiki
  // fallback submission. When loadProcessingTask itself throws, procCtx is null
  // and we skip the wiki fallback (there's no docId to submit for).
  let procCtx: ProcessingContext | null = null;

  try {
    procCtx = await loadProcessingTask(taskId, taskCtx.signal);
    await resolveProcessingModels(procCtx);

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 30 },
    });

    // Skip if the document was deleted while queued.
    const stillExists = await db.document.findUnique({
      where: { id: procCtx.docId },
      select: { id: true },
    });
    if (!stillExists) {
      return cancelledOutcome("Document no longer exists", { ok: false }, 0);
    }

    const result = await segmentAndPersistDocument(procCtx);
    taskCtx.throwIfCancelled();

    console.log(
      `[segment] doc ${procCtx.docId}: ${result.segmentCount} segments from ${result.atomCount} atoms ` +
      `(${result.method}, coverage=${result.coverageRate.toFixed(2)}, ${result.segmentationMs}ms)`,
    );

    if (shouldEnqueueWikiSynthesis(procCtx.options)) {
      try {
        const { getQueue } = await import("@/lib/queue");
        await getQueue().submit(
          "wiki_synthesize",
          { docId: procCtx.docId, options: procCtx.options },
          procCtx.doc.userId,
          { parentTaskId: taskId },
        );
        console.log(`[segment] doc ${procCtx.docId}: submitted wiki_synthesize (using ${result.segmentCount} segments)`);
      } catch (wikiSubmitErr) {
        console.warn(`[segment] doc ${procCtx.docId}: failed to submit wiki_synthesize:`, wikiSubmitErr);
      }
    }

    return { ok: true, segment: result };
  } catch (error) {
    taskCtx.throwIfCancelled();
    if (procCtx && shouldEnqueueWikiSynthesis(procCtx.options)) {
      try {
        const { getQueue } = await import("@/lib/queue");
        await getQueue().submit(
          "wiki_synthesize",
          { docId: procCtx.docId, options: procCtx.options },
          procCtx.doc.userId,
          { parentTaskId: taskId },
        );
        console.log(`[segment] doc ${procCtx.docId}: segmentation failed, submitted wiki_synthesize (chunk fallback)`);
      } catch (wikiSubmitErr) {
        console.warn(`[segment] doc ${procCtx.docId}: failed to submit wiki_synthesize after seg failure:`, wikiSubmitErr);
      }
    }

    throw error;
  }
}
