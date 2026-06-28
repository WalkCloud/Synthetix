import { db } from "@/lib/db";

export class SupersededDocumentProcessingTaskError extends Error {
  constructor() {
    super("Document processing task was superseded");
    this.name = "SupersededDocumentProcessingTaskError";
  }
}

function docIdFilter(docId: string): string {
  return `%"docId":"${docId}"%`;
}

export async function cancelActiveDocumentConvertTasks(userId: string, docId: string, exceptTaskId?: string): Promise<void> {
  await db.asyncTask.updateMany({
    where: {
      userId,
      type: "document_convert",
      status: { in: ["pending", "running"] },
      inputData: { contains: `"docId":"${docId}"` },
      ...(exceptTaskId ? { id: { not: exceptTaskId } } : {}),
    },
    data: {
      status: "cancelled",
      errorMessage: "Superseded by newer document processing task",
    },
  });
}

export async function isLatestDocumentConvertTask(userId: string, docId: string, taskId: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM async_tasks
     WHERE user_id = ? AND type = 'document_convert'
       AND input_data LIKE ?
     ORDER BY created_at DESC LIMIT 1`,
    userId,
    docIdFilter(docId),
  );
  return rows[0]?.id === taskId;
}

export async function assertLatestDocumentConvertTask(userId: string, docId: string, taskId: string): Promise<void> {
  if (!(await isLatestDocumentConvertTask(userId, docId, taskId))) {
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "cancelled",
        errorMessage: "Superseded by newer document processing task",
      },
    }).catch(() => undefined);
    throw new SupersededDocumentProcessingTaskError();
  }
}

export class SupersededRagEmbedIndexTaskError extends Error {
  constructor() {
    super("RAG embed/index task was superseded");
    this.name = "SupersededRagEmbedIndexTaskError";
  }
}

export async function cancelActiveRagEmbedIndexTasks(userId: string, docId: string, exceptTaskId?: string): Promise<void> {
  await db.asyncTask.updateMany({
    where: {
      userId,
      type: "rag_embed_index",
      status: { in: ["pending", "running"] },
      inputData: { contains: `"docId":"${docId}"` },
      ...(exceptTaskId ? { id: { not: exceptTaskId } } : {}),
    },
    data: {
      status: "cancelled",
      errorMessage: "Superseded by newer document processing task",
    },
  });
}

async function isLatestRagEmbedIndexTask(userId: string, docId: string, taskId: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM async_tasks
     WHERE user_id = ? AND type = 'rag_embed_index'
       AND input_data LIKE ?
     ORDER BY created_at DESC LIMIT 1`,
    userId,
    docIdFilter(docId),
  );
  return rows[0]?.id === taskId;
}

export async function assertLatestRagEmbedIndexTask(userId: string, docId: string, taskId: string): Promise<void> {
  if (!(await isLatestRagEmbedIndexTask(userId, docId, taskId))) {
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "cancelled",
        errorMessage: "Superseded by newer RAG embed/index task",
      },
    }).catch(() => undefined);
    throw new SupersededRagEmbedIndexTaskError();
  }
}

/**
 * Cancel any pending/running follow-up tasks (graph extraction, wiki synthesis)
 * for a document. These are now enqueued EARLY by rag-embed-index-worker
 * (wiki right after embedding, graph after basic-or-skip), so a reprocess must
 * tear them down alongside the embed/index task to avoid orphan workers racing
 * the fresh convert pipeline on the same chunk rows.
 *
 * Cancelled-but-still-running Python graph extraction is additionally waited
 * out via waitForDocActiveTasksToSettle (which includes 'rag_index').
 */
export async function cancelActiveFollowupTasks(userId: string, docId: string, exceptTaskId?: string): Promise<void> {
  await db.asyncTask.updateMany({
    where: {
      userId,
      type: { in: ["rag_index", "wiki_synthesize", "document_segment"] },
      status: { in: ["pending", "running"] },
      inputData: { contains: `"docId":"${docId}"` },
      ...(exceptTaskId ? { id: { not: exceptTaskId } } : {}),
    },
    data: {
      status: "cancelled",
      errorMessage: "Superseded by newer document processing task",
    },
  });
}

/**
 * Wait until no document-processing task for `docId` is still in `running`
 * status. Cancellation only flips the DB status; the in-memory worker may
 * still be mid-write. Callers that need to mutate `documentChunk` rows
 * (e.g. reprocess deleting all chunks before resubmitting) MUST first call
 * this helper after `cancelActive*Tasks`, otherwise they race the worker
 * and trigger Prisma "Record to update not found" errors.
 *
 * Best-effort: returns after `timeoutMs` regardless, so a stuck worker
 * does not block the request indefinitely.
 */
export async function waitForDocActiveTasksToSettle(
  userId: string,
  docId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  const filter = `%"docId":"${docId}"%`;
  while (Date.now() - start < timeoutMs) {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM async_tasks
       WHERE user_id = ?
         AND type IN ('document_convert', 'rag_embed_index', 'rag_index', 'wiki_synthesize', 'document_segment')
         AND status = 'running'
         AND input_data LIKE ?
       LIMIT 1`,
      userId,
      filter,
    );
    if (!rows[0]) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
