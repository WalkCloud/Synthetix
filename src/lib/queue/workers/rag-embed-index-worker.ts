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
import { syncFtsIndexForDocument } from "@/lib/search/fts";
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

    // ── 1. Embedding (also re-splits oversize chunks to their final shape) ──
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

    // ── 2. FTS sync — UNCONDITIONAL ──────────────────────────────────────────
    // Keyword search must be available for every document regardless of whether
    // the LightRAG basic pass runs. Previously FTS was called inside
    // indexDocument(), which is now skipped for graph-mode docs (see below),
    // so it must live here. It reads the same DB chunk rows embedding just
    // finalized (including any oversize-chunk re-split), and is idempotent
    // (DELETE-then-INSERT per doc), so calling it again from indexDocument's
    // basic path is harmless.
    await syncFtsIndexForDocument(ctx.docId).catch((err) => {
      console.warn("FTS index sync failed:", err);
    });

    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "indexing" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 70 },
    });

    // ── 3. Wiki synthesis — submit EARLY, parallel to graph/basic ────────────
    // Wiki reads ONLY DB chunk rows (content/index/title), never embeddings,
    // FTS, or LightRAG. It is therefore ready to run the instant embedding's
    // oversize-chunk re-split has finalized the chunk table. Submitting it
    // here — before the long graph/basic phase — means distilled knowledge
    // appears in parallel with graph extraction instead of after it.
    if (shouldEnqueueWikiSynthesis(ctx.options)) {
      const stillExists = await db.document.findUnique({
        where: { id: ctx.docId },
        select: { id: true },
      });
      if (stillExists) {
        const { getQueue } = await import("@/lib/queue");
        await getQueue().submit("wiki_synthesize", { docId: ctx.docId, options: ctx.options }, ctx.doc.userId);
        // LLM-guided domain segmentation runs in parallel with wiki. It produces
        // DocumentSegment[] (Wiki's preferred input + Graph's contextual-prefix
        // source). Wiki starts on chunks immediately and does NOT wait for it;
        // if segments finish first they improve quality on future reprocess.
        // Skip for tiny docs (no segmentation benefit) — threshold ~ a few atoms.
        await getQueue().submit("document_segment", { docId: ctx.docId, options: ctx.options }, ctx.doc.userId);
      }
    }

    // ── 4. LightRAG indexing — basic only; graph is deferred to rag_index ────
    // The previous design always ran a LightRAG "basic" pass here, then
    // enqueued a SEPARATE graph task that DELETED that basic output and
    // re-inserted with entity extraction. For graph-mode docs the basic pass
    // was pure overhead (written, then deleted). Now:
    //   - basic mode: run LightRAG basic here (unchanged behaviour).
    //   - graph mode: skip basic; the rag_index task inserts directly with
    //     graph extraction, reusing the embeddings.bin cache (no re-embed).
    const willGraph = shouldEnqueueGraphIndex(ctx.options);
    let indexResult: Awaited<ReturnType<typeof indexDocument>> = null;

    if (!willGraph) {
      const originalIndexMode = ctx.options.indexMode;
      ctx.options.indexMode = "basic";
      indexResult = await indexDocument(ctx);
      ctx.options.indexMode = originalIndexMode;
    }

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

    // ── 5. Status + graph enqueue ────────────────────────────────────────────
    // The document is now "ready" = basic retrieval available (embedding + FTS
    // are done). Graph/Wiki are ENHANCEMENT stages that run as parallel async
    // branches and report their own progress via asyncTask rows + the pipeline
    // view. Marking the doc ready here (instead of leaving it in
    // "indexing_graph") means the user can search/use the document immediately,
    // while the graph branch still shows as "active" in the pipeline UI. The
    // graph worker's later `status: ready` write is now idempotent.
    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "ready" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { status: "completed", progress: 100 },
    });

    if (willGraph) {
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
