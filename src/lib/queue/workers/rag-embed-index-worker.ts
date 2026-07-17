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
import { cancelledOutcome, type WorkerResult, type TaskExecutionContext } from "@/lib/queue/types";

export async function processRagEmbedIndex(
  taskId: string,
  ctx: TaskExecutionContext,
): Promise<WorkerResult> {
  let docId: string | undefined;

  try {
    const procCtx = await loadProcessingTask(taskId, ctx.signal);
    docId = procCtx.docId;
    await assertLatestRagEmbedIndexTask(procCtx.doc.userId, procCtx.docId, taskId);
    await resolveProcessingModels(procCtx);

    // ── 1. Embedding (also re-splits oversize chunks to their final shape) ──
    const needEmbedding = (procCtx.options.indexTarget || "full") !== "original";
    if (procCtx.embedModel && needEmbedding) {
      await db.document.update({
        where: { id: procCtx.docId },
        data: { status: "embedding" },
      });
      await db.asyncTask.updateMany({
        where: { id: taskId, status: "running" },
        data: { progress: 40 },
      });

      await embedDocumentChunks(procCtx);
      await assertLatestRagEmbedIndexTask(procCtx.doc.userId, procCtx.docId, taskId);
    }

    // ── 2. FTS sync — UNCONDITIONAL ──────────────────────────────────────────
    // Keyword search must be available for every document regardless of whether
    // the LightRAG basic pass runs. Previously FTS was called inside
    // indexDocument(), which is now skipped for graph-mode docs (see below),
    // so it must live here. It reads the same DB chunk rows embedding just
    // finalized (including any oversize-chunk re-split), and is idempotent
    // (DELETE-then-INSERT per doc), so calling it again from indexDocument's
    // basic path is harmless.
    await syncFtsIndexForDocument(procCtx.docId).catch((err) => {
      console.warn("FTS index sync failed:", err);
    });

    await db.document.update({
      where: { id: procCtx.docId },
      data: { status: "indexing" },
    });
    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 70 },
    });

    // ── 3. Wiki synthesis — submit EARLY, parallel to graph/basic ────────────
    // Wiki is NO LONGER submitted here. It used to run in parallel with
    // document_segment, but that meant wiki started before segments existed and
    // fell back to processing raw chunks (40 small units → ~195 fragmented
    // entries). Now wiki is submitted by the document_segment worker AFTER
    // segmentation succeeds, so wiki always uses the larger, coherent segments
    // (9 units → ~30-50 complete entries). Wiki's startup is delayed by the
    // segmentation duration (~6 min), but quality improves dramatically.
    // If segmentation is disabled/unsupported, the segment worker's failure
    // path still submits wiki (falling back to chunks) so wiki is never skipped.
    if (shouldEnqueueWikiSynthesis(procCtx.options)) {
      const stillExists = await db.document.findUnique({
        where: { id: procCtx.docId },
        select: { id: true },
      });
      if (stillExists) {
        const { getQueue } = await import("@/lib/queue");
        // LLM-guided domain segmentation runs now. On success it submits
        // wiki_synthesize (so wiki reads segments, not chunks). On failure it
        // submits wiki_synthesize anyway (chunk fallback).
        await getQueue().submit(
          "document_segment",
          { docId: procCtx.docId, options: procCtx.options },
          procCtx.doc.userId,
          { parentTaskId: taskId },
        );
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
    const willGraph = shouldEnqueueGraphIndex(procCtx.options);
    let indexResult: Awaited<ReturnType<typeof indexDocument>> = null;

    if (!willGraph) {
      const originalIndexMode = procCtx.options.indexMode;
      procCtx.options.indexMode = "basic";
      indexResult = await indexDocument(procCtx, undefined, taskId);
      procCtx.options.indexMode = originalIndexMode;
    }

    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 92 },
    });

    const mdForTags = procCtx.markdownPath
      ? await fs.promises.readFile(procCtx.markdownPath, "utf-8").catch(() => "")
      : "";
    if (mdForTags) {
      await autoTagDocument(procCtx, mdForTags);
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
      where: { id: procCtx.docId },
      data: { status: "ready" },
    });

    if (willGraph) {
      // Skip the follow-up graph task if the document was deleted while
      // embed/index was running. Without this guard, a freshly-submitted
      // rag_index task would start a long graph extraction against a doc
      // that no longer exists, recreating orphan entities/relations.
      const stillExists = await db.document.findUnique({
        where: { id: procCtx.docId },
        select: { id: true },
      });
      if (stillExists) {
        const { getQueue } = await import("@/lib/queue");
        await getQueue().submit(
          "rag_index",
          { docId: procCtx.docId, options: procCtx.options },
          procCtx.doc.userId,
          { parentTaskId: taskId },
        );
      }
    }

    return {
      ok: true,
      rag: indexResult?.rag,
      indexMode: indexResult?.indexMode,
    };
  } catch (error) {
    if (error instanceof SupersededRagEmbedIndexTaskError) {
      return cancelledOutcome(
        "Superseded by newer RAG embed/index task",
        { ok: false, superseded: true },
      );
    }
    if (docId) {
      await db.document.update({
        where: { id: docId },
        data: { status: "failed" },
      }).catch(() => {});
    }
    throw error;
  }
}
