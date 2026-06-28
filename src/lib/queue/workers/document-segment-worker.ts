/**
 * document_segment worker — LLM-guided domain segmentation.
 *
 * Produces DocumentSegment[] for a document (the Wiki primary input and the
 * Graph contextual-prefix source). Runs in parallel with wiki_synthesize
 * (which falls back to chunks if segments aren't ready yet) and, on success,
 * generates the Graph contextual-prefix chunks and triggers rag_index (graph).
 *
 * Design: docs/domain-segmentation-graph-wiki-optimization-final-2026-06-28.md §8, §11
 * Non-blocking on document readiness — by the time this runs the document is
 * already `ready` (basic retrieval usable). A segmentation failure just leaves
 * the doc operating on chunks (the pre-segmentation behaviour).
 */
import { db } from "@/lib/db";
import { loadProcessingTask, resolveProcessingModels } from "@/lib/documents/pipeline";
import { segmentAndPersistDocument } from "@/lib/documents/segmentation";

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

    return { ok: true, segment: result };
  } catch (error) {
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Document segmentation failed",
      },
    }).catch(() => undefined);
    // Non-blocking: the document stays usable via chunks. Re-throw so the queue
    // records the failure, but the document is already ready.
    throw error;
  }
}
