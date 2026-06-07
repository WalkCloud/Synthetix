import { db } from "@/lib/db";
import {
  indexDocument,
  loadProcessingTask,
  resolveProcessingModels,
} from "@/lib/documents/pipeline";
import { LocalStorageAdapter } from "@/lib/documents/storage";

const storage = new LocalStorageAdapter();

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

  ctx.outputDir = storage.getDocumentDir(ctx.docId, ctx.doc.userId);
  ctx.markdownPath = ctx.doc.markdownPath || `${ctx.outputDir}/full.md`;
  ctx.options.indexMode = "graph";

  try {
    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 20 },
    });

    const indexResult = await indexDocument(ctx);

    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        progress: 100,
        resultData: JSON.stringify(indexResult || { indexMode: "graph" }),
      },
    });

    return { ok: true, rag: indexResult?.rag, indexMode: indexResult?.indexMode };
  } catch (error) {
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
