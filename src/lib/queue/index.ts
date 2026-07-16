import { TaskQueue } from "./queue";
import { processRagEmbedIndex } from "./workers/rag-embed-index-worker";
import { cleanupDeletedDocument } from "./workers/document-cleanup-worker";
import { processDocumentGraph } from "./workers/document-graph-worker";
import { processDocumentConvert } from "./workers/document-convert-worker";
import { processWikiSynthesize } from "./workers/wiki-synthesize-worker";
import { processDocumentSegment } from "./workers/document-segment-worker";
import { generateDraftAll } from "./workers/draft-worker";
import { generateOutline } from "./workers/outline-worker";
import { db } from "@/lib/db";
import type { TaskPayload, TaskResult, ProcessingOptions, TaskExecutionContext } from "./types";
import { findTasksByResourceIdentity } from "./task-identity-query";
export { DocumentMutationBusyError, executionRegistry } from "./execution-registry";

let queue: TaskQueue | null = null;

const LONG_DRAFT_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const OUTLINE_GENERATE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — 4-level recursive expansion (parts→chapters→sections→subsections) fans out to many LLM calls
const GRAPH_INDEX_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const DOCUMENT_CONVERT_TIMEOUT_MS = readPositiveInt("DOCUMENT_CONVERT_TIMEOUT_MS", 60 * 60 * 1000); // 60 minutes
const WIKI_SYNTHESIZE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — per-chunk LLM calls (fast each, but large docs have 80+ chunks)
const DOCUMENT_SEGMENT_TIMEOUT_MS = readPositiveInt("DOCUMENT_SEGMENT_TIMEOUT_MS", 30 * 60 * 1000); // 30 min — 1 planning call + few refinement calls, but large docs have many windows
// Heartbeat-stall detection: a running task whose lastHeartbeatAt is older
// than this is marked failed (zombie worker defense). Defaults align with the
// LLM fetch timeout (5 min) — see queue.ts scanHeartbeats().
const QUEUE_HEARTBEAT_SCAN_INTERVAL_MS = readPositiveInt("QUEUE_HEARTBEAT_SCAN_INTERVAL_MS", 2 * 60 * 1000);
const QUEUE_HEARTBEAT_TIMEOUT_MS = readPositiveInt("QUEUE_HEARTBEAT_TIMEOUT_MS", 5 * 60 * 1000);

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

// Document-level pipeline concurrency.
//
// Design goal: when a user uploads up to 8 documents, document A's MAIN LINE
// (convert → embed → index) should finish before document B's main line starts,
// but once A moves into ENRICHMENT (wiki / segment / graph extraction), B's
// main line should begin immediately rather than starving behind A's long
// graph extraction. In other words: the main-line stages pipeline across docs,
// while heavy LLM-based enrichment stages are isolated so they never monopolize
// the slots a new document needs.
//
//   - Global concurrency 4: enough headroom for 2 main lines (convert+embed)
//     plus 1-2 enrichment tasks in flight. Each is CPU/IO/LLM-bounded, and the
//     adaptive LLM limiter gate-keeps the actual provider load regardless.
//   - document_convert cap 2: lets doc B start converting while doc A is still
//     embedding/indexing, so back-to-back uploads don't serialize at the front.
//   - rag_embed_index cap 2: embeddings are cheap+parallel-friendly (batched
//     HTTP, no LLM); two docs embedding concurrently is fine.
//   - rag_index / wiki_synthesize / document_segment cap 1 each: these are
//     LLM-heavy (graph entity extraction, wiki distillation, structural
//     segmentation). Running them serially per-type prevents provider
//     throttling while still letting them share the global pool with main-line
//     tasks of OTHER documents.
//
// Net effect for an 8-doc upload: docs flow through convert+embed 2 at a time,
// and each doc's enrichment runs in its own slot without blocking the next
// doc's main line. No document starves another beyond the 2-doc main-line gate.
const QUEUE_TOTAL_CONCURRENCY = readPositiveInt("QUEUE_TOTAL_CONCURRENCY", 4);
const QUEUE_RAG_EMBED_CONCURRENCY = readPositiveInt("QUEUE_RAG_EMBED_CONCURRENCY", 2);
const QUEUE_RAG_INDEX_CONCURRENCY = readPositiveInt("QUEUE_RAG_INDEX_CONCURRENCY", 1);
const QUEUE_DOCUMENT_CONVERT_CONCURRENCY = readPositiveInt("QUEUE_DOCUMENT_CONVERT_CONCURRENCY", 2);
const QUEUE_WIKI_SYNTHESIZE_CONCURRENCY = readPositiveInt("QUEUE_WIKI_SYNTHESIZE_CONCURRENCY", 1);
const QUEUE_DOCUMENT_SEGMENT_CONCURRENCY = readPositiveInt("QUEUE_DOCUMENT_SEGMENT_CONCURRENCY", 1);

let draining = false;

/**
 * For an orphaned document (stuck in an in-progress status with nothing
 * actively pushing it forward), decide whether recovery should resubmit it
 * and with what options.
 *
 * Returns `null` to SKIP recovery when a `document_convert` task is already
 * pending/running for this doc — the document is NOT actually orphaned, and
 * resubmitting would race the live upload. Because the recovery resubmit is
 * newer, the supersede guard (`assertLatestDocumentConvertTask`) would cancel
 * the task carrying the real options and run the empty-options recovery task
 * instead — which is exactly how uploaded documents lost `indexMode: "graph"`
 * and ended up with an empty knowledge graph.
 *
 * Otherwise returns the options to resubmit with: reused from the most recent
 * `document_convert` task for this doc (so a genuine crash-recovery keeps the
 * user's graph intent), falling back to `{}` when no prior task exists.
 */
export async function resolveRecoveryOptions(
  userId: string,
  docId: string,
): Promise<ProcessingOptions | null> {
  // A pending, or recently-running, document_convert task means something is
  // already (about to) process this doc — leave it alone. A "running" task
  // older than 1h is treated as stale (matching drain()'s window) so a
  // crashed worker doesn't permanently block recovery.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const active = await findTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["document_convert"],
    statuses: ["pending", "running"],
    order: "desc",
  });
  if (active.some((task) => task.status === "pending" || task.updatedAt >= oneHourAgo)) return null;

  // Genuinely stuck (e.g. server crashed mid-conversion and the task row is
  // gone/terminal): reuse the original options if a prior task recorded them.
  const latest = (await findTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["document_convert"],
    order: "desc",
    take: 1,
  }))[0] ?? null;
  if (latest?.inputData) {
    try {
      const parsed = JSON.parse(latest.inputData) as { options?: ProcessingOptions };
      if (parsed && typeof parsed === "object" && parsed.options) {
        return parsed.options;
      }
    } catch {
      /* malformed input — fall through to empty options */
    }
  }
  return {};
}

async function recoverOrphanedPhaseOne(): Promise<void> {
  // After a server restart, documents that were mid-conversion are stuck in
  // an in-progress status with nothing actively pushing them forward. Re-
  // submit them as document_convert tasks so the queue picks them up in
  // order, just like a freshly uploaded document would — but only if nothing
  // is already processing them (see resolveRecoveryOptions), and reusing the
  // original processing options so graph-mode intent survives a crash.
  //
  // NOTE: "uploading" and "pending" are intentionally excluded. "pending" is
  // the terminal state for a document that was uploaded but never had
  // "Start Processing" clicked — it must NOT be auto-processed on restart.
  // "uploading" means the upload itself never finished confirming; treating
  // either as orphaned would reprocess docs the user never asked to process.
  const orphaned = await db.document.findMany({
    where: {
      status: { in: ["queued", "converting", "splitting"] },
    },
    select: { id: true, userId: true },
  });
  if (orphaned.length === 0) return;
  const q = getQueue();
  for (const doc of orphaned) {
    const options = await resolveRecoveryOptions(doc.userId, doc.id);
    if (options === null) continue; // live task exists — don't race it
    await q.submit("document_convert", { docId: doc.id, options }, doc.userId).catch((err) => {
      console.warn(`Failed to resubmit orphaned document ${doc.id}:`, err);
    });
  }
}

export function getQueue(): TaskQueue {
  if (!queue) {
    queue = new TaskQueue({
      concurrency: QUEUE_TOTAL_CONCURRENCY,
      timeoutMs: 30 * 60 * 1000,
      heartbeatScanIntervalMs: QUEUE_HEARTBEAT_SCAN_INTERVAL_MS,
      heartbeatTimeoutMs: QUEUE_HEARTBEAT_TIMEOUT_MS,
      taskTimeoutMs: {
        draft_generate_all: LONG_DRAFT_TIMEOUT_MS,
        outline_generate: OUTLINE_GENERATE_TIMEOUT_MS,
        rag_index: GRAPH_INDEX_TIMEOUT_MS,
        document_convert: DOCUMENT_CONVERT_TIMEOUT_MS,
        wiki_synthesize: WIKI_SYNTHESIZE_TIMEOUT_MS,
        document_segment: DOCUMENT_SEGMENT_TIMEOUT_MS,
      },
      taskConcurrency: {
        rag_embed_index: QUEUE_RAG_EMBED_CONCURRENCY,
        rag_index: QUEUE_RAG_INDEX_CONCURRENCY,
        document_convert: QUEUE_DOCUMENT_CONVERT_CONCURRENCY,
        wiki_synthesize: QUEUE_WIKI_SYNTHESIZE_CONCURRENCY,
        document_segment: QUEUE_DOCUMENT_SEGMENT_CONCURRENCY,
      },
    });

    queue.registerWorker("document_convert", async (
      payload: TaskPayload,
      ctx,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      return processDocumentConvert(taskId, ctx);
    });

    queue.registerWorker("rag_embed_index", async (
      payload: TaskPayload,
      ctx,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      const result = await processRagEmbedIndex(taskId, ctx);
      return result;
    });

    queue.registerWorker("document_cleanup", async (
      payload: TaskPayload,
      ctx,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      return cleanupDeletedDocument(taskId, ctx);
    });

    queue.registerWorker("rag_index", async (
      payload: TaskPayload,
      ctx,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      return processDocumentGraph(taskId, ctx);
    });

    queue.registerWorker("wiki_synthesize", async (
      payload: TaskPayload,
      ctx,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      return processWikiSynthesize(taskId, ctx);
    });

    queue.registerWorker("document_segment", async (
      payload: TaskPayload,
      ctx,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      return processDocumentSegment(taskId, ctx);
    });

    queue.registerWorker("draft_generate_all", async (
      payload: TaskPayload,
      ctx,
    ): Promise<TaskResult> => {
      const draftId = payload.draftId as string;
      if (!ctx.taskId || !draftId || !ctx.userId) {
        throw new Error("Missing required draft generation payload");
      }
      return generateDraftAll(
        {
          ...payload,
          taskId: ctx.taskId,
          draftId,
          userId: ctx.userId,
        },
        ctx,
      );
    });

    queue.registerWorker("outline_generate", async (
      payload: TaskPayload,
      ctx,
    ): Promise<TaskResult> => {
      return generateOutline(payload, ctx);
    });

    if (!draining) {
      draining = true;
      void queue.drain();
    }

    // Start the heartbeat-stall scanner so zombie workers (e.g. an LLM
    // provider holding a connection open without replying) are failed within
    // minutes instead of waiting for the 4h hard timeout.
    queue.startHeartbeatScan();

    void recoverOrphanedPhaseOne();
  }
  return queue;
}
