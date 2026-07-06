import { db } from "@/lib/db";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import {
  convertDocument,
  resolveProcessingModels,
  calculateSplitPlan,
  splitAndPersistChunks,
  type ProcessingContext,
} from "@/lib/documents/pipeline";
import { persistDocumentAtoms } from "@/lib/documents/atoms";
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

export type PhaseOneProgressFn = (event: Record<string, unknown>) => void | Promise<void>;

export async function runPhaseOne(
  docId: string,
  options: ProcessingOptions,
  onProgress?: PhaseOneProgressFn,
): Promise<void> {
  const ctx = await createPhaseOneContext(docId, options);

  await db.document.update({
    where: { id: ctx.docId },
    data: { status: "converting" },
  });

  await onProgress?.({ stage: "converting", progress: 8, message: "Preparing document conversion" });

  const markdown = await convertDocument(ctx, storage, onProgress);

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
  await onProgress?.({ stage: "converted", progress: 70, message: "Document conversion completed" });

  if (plan.shouldSplit) {
    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "splitting" },
    });
  }
  await onProgress?.({
    stage: "splitting",
    progress: 75,
    message: plan.shouldSplit ? "Splitting document into retrieval chunks" : "Persisting single document chunk",
  });

  await splitAndPersistChunks(ctx, markdown, plan, storage);

  // Persist DocumentAtoms — the coordinate system for LLM-guided domain
  // segmentation. Idempotent + non-blocking: atoms are an enhancement; if
  // parsing fails the doc still processes normally via chunks.
  const atomCount = await persistDocumentAtoms(ctx.docId, markdown, ctx.structurePath).catch((err) => {
    console.warn(`[phase1] atom persistence failed for doc ${ctx.docId} (non-blocking):`, err);
    return 0;
  });
  if (atomCount > 0) {
    console.log(`[phase1] persisted ${atomCount} document atoms for doc ${ctx.docId}`);
  }
  await onProgress?.({ stage: "chunks_persisted", progress: 95, message: "Document chunks persisted" });

  const { getQueue } = await import("@/lib/queue");
  const queue = getQueue();
  await queue.submit("rag_embed_index", {
    docId: ctx.docId,
    sourceTaskId: docId,
    options: ctx.options,
  }, ctx.doc.userId);
}
