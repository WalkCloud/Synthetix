import { cancelTasksByResourceIdentity, findTasksByResourceIdentity } from "@/lib/queue/task-identity-query";

export class SupersededDocumentProcessingTaskError extends Error {
  constructor() {
    super("Document processing task was superseded");
    this.name = "SupersededDocumentProcessingTaskError";
  }
}

export async function cancelActiveDocumentConvertTasks(userId: string, docId: string, exceptTaskId?: string): Promise<void> {
  await cancelTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["document_convert"],
    statuses: ["pending", "running"],
    exceptTaskId,
    errorMessage: "Superseded by newer document processing task",
  });
}

export async function isLatestDocumentConvertTask(userId: string, docId: string, taskId: string): Promise<boolean> {
  const rows = await findTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["document_convert"],
    order: "desc",
    take: 1,
  });
  return rows[0]?.id === taskId;
}

export async function assertLatestDocumentConvertTask(userId: string, docId: string, taskId: string): Promise<void> {
  if (!(await isLatestDocumentConvertTask(userId, docId, taskId))) {
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
  await cancelTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["rag_embed_index"],
    statuses: ["pending", "running"],
    exceptTaskId,
    errorMessage: "Superseded by newer document processing task",
  });
}

async function isLatestRagEmbedIndexTask(userId: string, docId: string, taskId: string): Promise<boolean> {
  const rows = await findTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["rag_embed_index"],
    order: "desc",
    take: 1,
  });
  return rows[0]?.id === taskId;
}

export async function assertLatestRagEmbedIndexTask(userId: string, docId: string, taskId: string): Promise<void> {
  if (!(await isLatestRagEmbedIndexTask(userId, docId, taskId))) {
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
  await cancelTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["rag_index", "wiki_synthesize", "document_segment"],
    statuses: ["pending", "running"],
    exceptTaskId,
    errorMessage: "Superseded by newer document processing task",
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
  while (Date.now() - start < timeoutMs) {
    const rows = await findTasksByResourceIdentity({
      userId,
      field: "documentId",
      value: docId,
      types: ["document_convert", "rag_embed_index", "rag_index", "wiki_synthesize", "document_segment"],
      statuses: ["running"],
      take: 1,
    });
    if (!rows[0]) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
