import { cancelTasksByResourceIdentity, findTasksByResourceIdentity } from "@/lib/queue/task-identity-query";
import { derivePipelineModes } from "@/lib/queue/workers/index-mode-flags";

export interface DocumentProcessingTimingTask {
  id: string;
  type: string;
  status: string;
  progress: number;
  inputData: string | null;
  resultData: string | null;
  operationId: string | null;
  parentTaskId: string | null;
  attempt: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface DocumentProcessingTiming {
  processingDurationMs: number | null;
  processingStartedAt: string | null;
  basicDurationMs: number | null;
  enhancementDurationMs: number | null;
}

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);

function latestConvertTask(tasks: DocumentProcessingTimingTask[]) {
  return tasks.filter((task) => task.type === "document_convert").reduce<DocumentProcessingTimingTask | undefined>(
    (latest, task) => (!latest || task.createdAt > latest.createdAt ? task : latest),
    undefined,
  );
}

function descendsFromRoot(
  task: DocumentProcessingTimingTask,
  rootId: string,
  tasksById: Map<string, DocumentProcessingTimingTask>,
): boolean {
  let parentId = task.parentTaskId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (parentId === rootId) return true;
    visited.add(parentId);
    parentId = tasksById.get(parentId)?.parentTaskId ?? null;
  }
  return false;
}

export function selectLatestDocumentProcessingRound(
  tasks: DocumentProcessingTimingTask[],
): DocumentProcessingTimingTask[] {
  const convert = latestConvertTask(tasks);
  if (!convert) return [];
  if (convert.operationId) {
    return tasks.filter((task) => task.operationId === convert.operationId);
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const nextConvertAt = tasks
    .filter((task) => task.type === "document_convert" && task.createdAt > convert.createdAt)
    .reduce<Date | null>((next, task) => !next || task.createdAt < next ? task.createdAt : next, null);
  return tasks.filter((task) => (
    task.id === convert.id
    || (
      task.type !== "document_convert"
      && task.operationId === null
      && task.createdAt >= convert.createdAt
      && (!nextConvertAt || task.createdAt < nextConvertAt)
      && (task.parentTaskId === null || descendsFromRoot(task, convert.id, tasksById))
    )
  ));
}

function latestTaskOfType(tasks: DocumentProcessingTimingTask[], type: string) {
  const matches = tasks.filter((task) => task.type === type);
  if (type === "rag_index") {
    return matches.reduce<DocumentProcessingTimingTask | undefined>((latest, task) => {
      if (!latest) return task;
      const attemptDelta = (task.attempt ?? 0) - (latest.attempt ?? 0);
      return attemptDelta > 0 || (attemptDelta === 0 && task.createdAt > latest.createdAt) ? task : latest;
    }, undefined);
  }
  return matches.reduce<DocumentProcessingTimingTask | undefined>(
    (latest, task) => (!latest || task.createdAt > latest.createdAt ? task : latest),
    undefined,
  );
}

function durationForTasks(start: Date, tasks: Array<DocumentProcessingTimingTask | undefined>): number | null {
  if (tasks.some((task) => !task || !TERMINAL_TASK_STATUSES.has(task.status) || !task.finishedAt)) return null;
  const end = tasks.reduce<Date>(
    (latest, task) => task!.finishedAt! > latest ? task!.finishedAt! : latest,
    start,
  );
  const duration = end.getTime() - start.getTime();
  return duration >= 0 ? duration : null;
}

export function aggregateDocumentProcessingTiming(
  tasks: DocumentProcessingTimingTask[],
): DocumentProcessingTiming {
  const operationTasks = selectLatestDocumentProcessingRound(tasks);
  const convert = latestConvertTask(operationTasks);
  const start = convert?.startedAt ?? (
    convert && TERMINAL_TASK_STATUSES.has(convert.status) ? convert.createdAt : null
  );
  if (!convert || !start) {
    return {
      processingDurationMs: null,
      processingStartedAt: null,
      basicDurationMs: null,
      enhancementDurationMs: null,
    };
  }

  const embed = latestTaskOfType(operationTasks, "rag_embed_index");
  const graph = latestTaskOfType(operationTasks, "rag_index");
  const segment = latestTaskOfType(operationTasks, "document_segment");
  const wiki = latestTaskOfType(operationTasks, "wiki_synthesize");
  const { graphMode, wikiEnabled } = derivePipelineModes(convert.inputData, !!graph, !!wiki);

  const basicDurationMs = durationForTasks(start, [convert, embed]);
  const requiredEnhancementTasks = [
    ...(graphMode ? [graph] : []),
    ...(wikiEnabled ? [segment, wiki] : []),
  ];
  const processingDurationMs = durationForTasks(start, [convert, embed, ...requiredEnhancementTasks]);

  let enhancementDurationMs: number | null = null;
  if (requiredEnhancementTasks.length > 0 && requiredEnhancementTasks.every((task) => !!task)) {
    const enhancementTasks = requiredEnhancementTasks as DocumentProcessingTimingTask[];
    const enhancementStart = enhancementTasks.reduce<Date>((earliest, task) => {
      const taskStart = task.startedAt ?? task.createdAt;
      return taskStart < earliest ? taskStart : earliest;
    }, enhancementTasks[0].startedAt ?? enhancementTasks[0].createdAt);
    enhancementDurationMs = durationForTasks(enhancementStart, enhancementTasks);
  }

  return {
    processingDurationMs,
    processingStartedAt: start.toISOString(),
    basicDurationMs,
    enhancementDurationMs,
  };
}

async function abortAndAwaitRunningTasks(runningIds: string[]): Promise<void> {
  if (runningIds.length === 0) return;
  const { executionRegistry, getQueue } = await import("@/lib/queue");
  const queue = getQueue();
  await Promise.all(runningIds.map((taskId) => queue.cancel(taskId)));
  await executionRegistry.awaitTaskExecutions(runningIds);
}

export class SupersededDocumentProcessingTaskError extends Error {
  constructor() {
    super("Document processing task was superseded");
    this.name = "SupersededDocumentProcessingTaskError";
  }
}

export async function cancelActiveDocumentConvertTasks(userId: string, docId: string, exceptTaskId?: string): Promise<void> {
  const { runningIds } = await cancelTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["document_convert"],
    statuses: ["pending", "running"],
    exceptTaskId,
    errorMessage: "Superseded by newer document processing task",
  });
  await abortAndAwaitRunningTasks(runningIds);
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
  const { runningIds } = await cancelTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["rag_embed_index"],
    statuses: ["pending", "running"],
    exceptTaskId,
    errorMessage: "Superseded by newer document processing task",
  });
  await abortAndAwaitRunningTasks(runningIds);
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
  const { runningIds } = await cancelTasksByResourceIdentity({
    userId,
    field: "documentId",
    value: docId,
    types: ["rag_index", "wiki_synthesize", "document_segment"],
    statuses: ["pending", "running"],
    exceptTaskId,
    errorMessage: "Superseded by newer document processing task",
  });
  await abortAndAwaitRunningTasks(runningIds);
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
