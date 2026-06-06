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
import { autoTagDocument } from "@/lib/documents/auto-tagger";
import type { ProcessingOptions } from "@/lib/queue/types";

const storage = new LocalStorageAdapter();

export function getInitialIndexMode(options: Pick<ProcessingOptions, "indexMode">): "basic" {
  return options.indexMode === "graph" ? "basic" : "basic";
}

export function shouldEnqueueGraphIndex(options: Pick<ProcessingOptions, "indexMode" | "indexTarget">): boolean {
  return options.indexMode === "graph" && (options.indexTarget || "full") === "full";
}

export async function processDocument(taskId: string): Promise<{ ok: boolean; rag?: { status: string; chunks: number; error?: string; graphEntities?: number; storage?: Record<string, string> }; indexMode?: string }> {
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

    const originalIndexMode = ctx.options.indexMode;
    ctx.options.indexMode = getInitialIndexMode(ctx.options);
    const indexResult = await indexDocument(ctx);
    ctx.options.indexMode = originalIndexMode;

    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 92 },
    });

    const mdForTags = ctx.markdownPath
      ? await import("fs").then((fs) => fs.promises.readFile(ctx.markdownPath, "utf-8").catch(() => ""))
      : "";
    if (mdForTags) {
      await autoTagDocument(ctx, mdForTags);
    }

    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "ready" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { status: "completed", progress: 100 },
    });

    if (shouldEnqueueGraphIndex(ctx.options)) {
      const { getQueue } = await import("@/lib/queue");
      await getQueue().submit("rag_index", { docId: ctx.docId, options: ctx.options }, ctx.doc.userId);
    }

    return {
      ok: true,
      rag: indexResult?.rag,
      indexMode: indexResult?.indexMode,
    };
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
    throw error;
  }
}
