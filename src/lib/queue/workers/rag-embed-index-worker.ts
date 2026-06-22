import fs from "fs";
import { db } from "@/lib/db";
import {
  loadProcessingTask,
  resolveProcessingModels,
  embedDocumentChunks,
  indexDocument,
} from "@/lib/documents/pipeline";
import { autoTagDocument } from "@/lib/documents/auto-tagger";
import { assertLatestRagEmbedIndexTask, SupersededRagEmbedIndexTaskError } from "@/lib/documents/processing-tasks";
import { shouldEnqueueGraphIndex, shouldEnqueueWikiSynthesis } from "./index-mode-flags";

export async function processRagEmbedIndex(
  taskId: string,
): Promise<{ ok: boolean; rag?: { status: string; chunks: number; error?: string; graphEntities?: number; storage?: Record<string, string> }; indexMode?: string }> {
  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 10 },
  });

  let docId: string | undefined;

  try {
    const ctx = await loadProcessingTask(taskId);
    docId = ctx.docId;
    await assertLatestRagEmbedIndexTask(ctx.doc.userId, ctx.docId, taskId);
    await resolveProcessingModels(ctx);

    const needEmbedding = (ctx.options.indexTarget || "full") !== "original";
    if (ctx.embedModel && needEmbedding) {
      await db.document.update({
        where: { id: ctx.docId },
        data: { status: "embedding" },
      });
      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 40 },
      });

      await embedDocumentChunks(ctx);
      await assertLatestRagEmbedIndexTask(ctx.doc.userId, ctx.docId, taskId);
    }

    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "indexing" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 70 },
    });

    // Embed/index always runs in basic mode here; the optional graph pass
    // is enqueued separately as a "rag_index" task after this completes
    // (see shouldEnqueueGraphIndex below).
    const originalIndexMode = ctx.options.indexMode;
    ctx.options.indexMode = "basic";
    const indexResult = await indexDocument(ctx);
    ctx.options.indexMode = originalIndexMode;

    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 92 },
    });

    const mdForTags = ctx.markdownPath
      ? await fs.promises.readFile(ctx.markdownPath, "utf-8").catch(() => "")
      : "";
    if (mdForTags) {
      await autoTagDocument(ctx, mdForTags);
    }

    // Graph mode runs a SECOND, long phase (rag_index) after this basic pass
    // completes. Only mark the document ready once that graph phase ALSO
    // finishes — otherwise the doc shows "ready" (and the Processing Pipeline
    // goes all-green) while the knowledge graph is still being extracted for
    // ~30+ minutes. The graph worker flips "indexing_graph" -> "ready".
    const willGraph = shouldEnqueueGraphIndex(ctx.options);
    await db.document.update({
      where: { id: ctx.docId },
      data: { status: willGraph ? "indexing_graph" : "ready" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { status: "completed", progress: 100 },
    });

    if (shouldEnqueueGraphIndex(ctx.options)) {
      // Skip the follow-up graph task if the document was deleted while
      // embed/index was running. Without this guard, a freshly-submitted
      // rag_index task would start a long graph extraction against a doc
      // that no longer exists, recreating orphan entities/relations.
      const stillExists = await db.document.findUnique({
        where: { id: ctx.docId },
        select: { id: true },
      });
      if (stillExists) {
        const { getQueue } = await import("@/lib/queue");
        await getQueue().submit("rag_index", { docId: ctx.docId, options: ctx.options }, ctx.doc.userId);
        // NOTE: Wiki synthesis is enqueued by the graph worker after graph
        // completes (so Wiki entries can reference extracted entities).
        // See document-graph-worker.ts.
      }
    } else if (shouldEnqueueWikiSynthesis(ctx.options)) {
      // No graph phase — the document is already `ready`. Enqueue Wiki
      // synthesis directly as the final async knowledge-precipitation layer.
      const stillExists = await db.document.findUnique({
        where: { id: ctx.docId },
        select: { id: true },
      });
      if (stillExists) {
        const { getQueue } = await import("@/lib/queue");
        await getQueue().submit("wiki_synthesize", { docId: ctx.docId, options: ctx.options }, ctx.doc.userId);
      }
    }

    return {
      ok: true,
      rag: indexResult?.rag,
      indexMode: indexResult?.indexMode,
    };
  } catch (error) {
    if (error instanceof SupersededRagEmbedIndexTaskError) {
      return { ok: false };
    }
    if (docId) {
      await db.document.update({
        where: { id: docId },
        data: { status: "failed" },
      }).catch(() => {});
    }
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "RAG embed/index failed",
      },
    });
    throw error;
  }
}
