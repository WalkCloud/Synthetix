import { TaskQueue } from "./queue";
import { processRagEmbedIndex } from "./workers/rag-embed-index-worker";
import { cleanupDeletedDocument } from "./workers/document-cleanup-worker";
import { processDocumentGraph } from "./workers/document-graph-worker";
import { processDocumentConvert } from "./workers/document-convert-worker";
import { generateDraftAll } from "./workers/draft-worker";
import { generateOutline } from "./workers/outline-worker";
import { db } from "@/lib/db";
import type { TaskPayload, TaskResult, ProcessingOptions } from "./types";

let queue: TaskQueue | null = null;

const LONG_DRAFT_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const OUTLINE_GENERATE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — 4-level recursive expansion (parts→chapters→sections→subsections) fans out to many LLM calls
const GRAPH_INDEX_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const DOCUMENT_CONVERT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

// Default 1: every document processing stage (convert / embed / index)
// shares this queue, so serialising at the queue level is the simplest way
// to guarantee one document is fully processed before the next begins.
// Override via QUEUE_TOTAL_CONCURRENCY env var if a host has spare capacity.
const QUEUE_TOTAL_CONCURRENCY = readPositiveInt("QUEUE_TOTAL_CONCURRENCY", 1);
const QUEUE_RAG_EMBED_CONCURRENCY = readPositiveInt("QUEUE_RAG_EMBED_CONCURRENCY", 1);
const QUEUE_RAG_INDEX_CONCURRENCY = readPositiveInt("QUEUE_RAG_INDEX_CONCURRENCY", 1);
const QUEUE_DOCUMENT_CONVERT_CONCURRENCY = readPositiveInt("QUEUE_DOCUMENT_CONVERT_CONCURRENCY", 1);

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
  const active = await db.asyncTask.findFirst({
    where: {
      userId,
      type: "document_convert",
      inputData: { contains: `"docId":"${docId}"` },
      OR: [
        { status: "pending" },
        { status: "running", updatedAt: { gte: oneHourAgo } },
      ],
    },
    select: { id: true },
  });
  if (active) return null;

  // Genuinely stuck (e.g. server crashed mid-conversion and the task row is
  // gone/terminal): reuse the original options if a prior task recorded them.
  const latest = await db.asyncTask.findFirst({
    where: {
      userId,
      type: "document_convert",
      inputData: { contains: `"docId":"${docId}"` },
    },
    orderBy: { createdAt: "desc" },
    select: { inputData: true },
  });
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
  const orphaned = await db.document.findMany({
    where: {
      status: { in: ["uploading", "queued", "converting", "splitting"] },
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
      taskTimeoutMs: {
        draft_generate_all: LONG_DRAFT_TIMEOUT_MS,
        outline_generate: OUTLINE_GENERATE_TIMEOUT_MS,
        rag_index: GRAPH_INDEX_TIMEOUT_MS,
        document_convert: DOCUMENT_CONVERT_TIMEOUT_MS,
      },
      taskConcurrency: {
        rag_embed_index: QUEUE_RAG_EMBED_CONCURRENCY,
        rag_index: QUEUE_RAG_INDEX_CONCURRENCY,
        document_convert: QUEUE_DOCUMENT_CONVERT_CONCURRENCY,
      },
    });

    queue.registerWorker("document_convert", async (
      payload: TaskPayload,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      return processDocumentConvert(taskId);
    });

    queue.registerWorker("rag_embed_index", async (
      payload: TaskPayload,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      const result = await processRagEmbedIndex(taskId);
      return result;
    });

    queue.registerWorker("document_cleanup", async (
      payload: TaskPayload,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      return cleanupDeletedDocument(taskId);
    });

    queue.registerWorker("rag_index", async (
      payload: TaskPayload,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      return processDocumentGraph(taskId);
    });

    queue.registerWorker("draft_generate_all", async (
      payload: TaskPayload,
      onProgress: (progress: number) => void,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      const draftId = payload.draftId as string;
      const userId = payload.userId as string;
      if (!taskId || !draftId || !userId) {
        throw new Error("Missing required draft generation payload");
      }
      return generateDraftAll(
        {
          ...payload,
          taskId,
          draftId,
          userId,
        },
        onProgress,
      );
    });

    queue.registerWorker("outline_generate", async (
      payload: TaskPayload,
      onProgress: (progress: number) => void,
    ): Promise<TaskResult> => {
      return generateOutline(payload, onProgress);
    });

    if (!draining) {
      draining = true;
      void queue.drain();
    }

    void recoverOrphanedPhaseOne();
  }
  return queue;
}
