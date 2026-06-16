import { db } from "@/lib/db";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import {
  convertDocument,
  resolveProcessingModels,
  calculateSplitPlan,
  splitAndPersistChunks,
  type ProcessingContext,
} from "@/lib/documents/pipeline";
import type { ProcessingOptions } from "@/lib/queue/types";

const storage = new LocalStorageAdapter();

async function createPhaseOneContext(docId: string, options: ProcessingOptions): Promise<ProcessingContext> {
  const doc = await db.document.findUnique({ where: { id: docId } });
  if (!doc) throw new Error(`Document ${docId} not found`);

  return {
    taskId: docId,
    docId,
    doc,
    options,
    outputDir: "",
    markdownPath: "",
    structurePath: null,
    imageManifestPath: null,
    conversionMethod: null,
    writingModel: null,
    embedModel: null,
    contextWindow: 4096,
    splitThreshold: 2048,
    chunkMaxTokens: 1536,
  };
}

export async function runPhaseOne(docId: string, options: ProcessingOptions): Promise<void> {
  const ctx = await createPhaseOneContext(docId, options);

  await db.document.update({
    where: { id: ctx.docId },
    data: { status: "converting" },
  });

  const markdown = await convertDocument(ctx, storage);

  await resolveProcessingModels(ctx);

  const plan = calculateSplitPlan(ctx, markdown);

  await db.document.update({
    where: { id: ctx.docId },
    data: {
      markdownPath: ctx.markdownPath,
      markdownSize: Buffer.byteLength(markdown, "utf-8"),
      tokenEstimate: plan.tokenCount,
      wordCount: plan.wordCount,
      conversionMethod: ctx.conversionMethod,
      structurePath: ctx.structurePath,
      imageManifestPath: ctx.imageManifestPath,
    },
  });

  if (plan.shouldSplit) {
    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "splitting" },
    });
  }

  await splitAndPersistChunks(ctx, markdown, plan, storage);

  const { getQueue } = await import("@/lib/queue");
  const queue = getQueue();
  await queue.submit("rag_embed_index", {
    docId: ctx.docId,
    sourceTaskId: docId,
    options: ctx.options,
  }, ctx.doc.userId);
}
