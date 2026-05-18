import { db } from "@/lib/db";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import {
  loadProcessingTask,
  convertDocument,
  resolveProcessingModels,
  calculateSplitPlan,
  splitAndPersistChunks,
  embedDocumentChunks,
  indexDocument,
} from "@/lib/documents/pipeline";

const storage = new LocalStorageAdapter();

export async function processDocument(taskId: string): Promise<void> {
  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 10 },
  });

  const ctx = await loadProcessingTask(taskId);

  await db.document.update({
    where: { id: ctx.docId },
    data: { status: "converting" },
  });

  try {
    const markdown = await convertDocument(ctx, storage);

    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 40 },
    });

    await resolveProcessingModels(ctx);

    const plan = calculateSplitPlan(ctx, markdown);

    await db.document.update({
      where: { id: ctx.docId },
      data: {
        markdownPath: ctx.markdownPath,
        markdownSize: Buffer.byteLength(markdown, "utf-8"),
        tokenEstimate: plan.tokenCount,
        wordCount: plan.wordCount,
      },
    });

    if (plan.shouldSplit) {
      await db.document.update({
        where: { id: ctx.docId },
        data: { status: "splitting" },
      });
      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 60 },
      });

      await splitAndPersistChunks(ctx, markdown, plan, storage);

      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 65 },
      });
    } else {
      await splitAndPersistChunks(ctx, markdown, plan, storage);
    }

    const needEmbedding = (ctx.options.indexTarget || "full") !== "original";
    if (ctx.embedModel && needEmbedding) {
      await db.document.update({
        where: { id: ctx.docId },
        data: { status: "embedding" },
      });
      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 80 },
      });

      await embedDocumentChunks(ctx);
    }

    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "indexing" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 85 },
    });

    await indexDocument(ctx);

    if (ctx.options.indexMode === "graph") {
      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 87 },
      });
    }

    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "ready" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { status: "completed", progress: 100 },
    });
  } catch (error) {
    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "failed" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Document processing failed",
      },
    });
  }
}
