import { db } from "@/lib/db";
import {
  indexDocument,
  loadProcessingTask,
  resolveProcessingModels,
} from "@/lib/documents/pipeline";

export function buildGraphTaskProgressUpdate(
  event: Record<string, unknown>,
  now = new Date(),
): { progress: number; resultData: string } {
  const progress = typeof event.progress === "number" ? event.progress : 20;
  return {
    progress: Math.max(0, Math.min(99, progress)),
    resultData: JSON.stringify({
      stage: typeof event.stage === "string" ? event.stage : "indexing",
      message: typeof event.message === "string" ? event.message : "Indexing knowledge graph",
      processed: typeof event.processed === "number" ? event.processed : undefined,
      total: typeof event.total === "number" ? event.total : undefined,
      lastHeartbeatAt: now.toISOString(),
    }),
  };
}

export async function processDocumentGraph(taskId: string): Promise<{ ok: boolean; rag?: unknown; indexMode?: string }> {
  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 5 },
  });

  const ctx = await loadProcessingTask(taskId);
  await resolveProcessingModels(ctx);

  // Check if document still exists before starting graph extraction
  const currentDoc = await db.document.findUnique({ where: { id: ctx.docId } });
  if (!currentDoc || currentDoc.status === "failed") {
    await db.asyncTask.update({
      where: { id: taskId },
      data: { status: "cancelled", errorMessage: "Document no longer exists", progress: 0 },
    });
    return { ok: false };
  }

  ctx.options.indexMode = "graph";

  try {
    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 20 },
    });

    const indexResult = await indexDocument(ctx, async (event) => {
      await db.asyncTask.update({
        where: { id: taskId },
        data: buildGraphTaskProgressUpdate(event),
      });
    });

    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        progress: 100,
        resultData: JSON.stringify(indexResult || { indexMode: "graph" }),
      },
    });

    // Graph extraction is the FINAL pipeline stage. The embed worker left the
    // document in "indexing_graph" awaiting us, so only here — once the
    // knowledge graph is built — does the document become truly ready.
    // (LightRAG soft-failures are non-blocking: basic indexing already
    // succeeded, so the doc is usable and "ready" is correct.)
    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "ready" },
    }).catch(() => {});

    return { ok: true, rag: indexResult?.rag, indexMode: indexResult?.indexMode };
  } catch (error) {
    if (ctx.docId) {
      await db.document.update({
        where: { id: ctx.docId },
        data: { status: "failed" },
      }).catch(() => {});
    }
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Document graph indexing failed",
      },
    });
    throw error;
  }
}
