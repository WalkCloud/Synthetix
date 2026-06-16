import { TaskQueue } from "./queue";
import { processRagEmbedIndex } from "./workers/rag-embed-index-worker";
import { cleanupDeletedDocument } from "./workers/document-cleanup-worker";
import { processDocumentGraph } from "./workers/document-graph-worker";
import { processDocumentConvert } from "./workers/document-convert-worker";
import { generateDraftAll } from "./workers/draft-worker";
import { generateOutline } from "./workers/outline-worker";
import { db } from "@/lib/db";
import type { TaskPayload, TaskResult } from "./types";

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

async function recoverOrphanedPhaseOne(): Promise<void> {
  // After a server restart, documents that were mid-conversion are stuck in
  // an in-progress status with nothing actively pushing them forward. Re-
  // submit them as document_convert tasks so the queue picks them up in
  // order, just like a freshly uploaded document would.
  const orphaned = await db.document.findMany({
    where: {
      status: { in: ["uploading", "queued", "converting", "splitting"] },
    },
    select: { id: true, userId: true },
  });
  if (orphaned.length === 0) return;
  const q = getQueue();
  for (const doc of orphaned) {
    await q.submit("document_convert", { docId: doc.id, options: {} }, doc.userId).catch((err) => {
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
