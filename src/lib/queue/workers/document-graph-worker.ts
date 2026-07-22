import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { resolveTaskIdentity } from "@/lib/queue/task-identity";
import {
  indexDocument,
  loadProcessingTask,
  resolveProcessingModels,
} from "@/lib/documents/pipeline";
import {
  classifyGraphError,
  graphFailureWarning,
  graphRetryDelay,
  GRAPH_MAX_RETRIES,
  type GraphErrorType,
} from "./graph-error";
import { cancelledOutcome, completedOutcome, type WorkerResult, type TaskExecutionContext } from "@/lib/queue/types";

/** Attempt count is carried in task inputData so a re-enqueued retry knows its index. */
const ATTEMPT_KEY = "_graphAttempt";

export function buildGraphTaskProgressUpdate(
  event: Record<string, unknown>,
  now = new Date(),
): { progress: number; resultData: string; heartbeatAt: Date; leaseExpiresAt: Date } {
  const progress = typeof event.progress === "number" ? event.progress : 20;
  // The heartbeat scan (queue.ts scanHeartbeats) checks the `heartbeatAt`
  // column — NOT the `lastHeartbeatAt` field inside resultData JSON. Without
  // updating heartbeatAt here, a graph task that runs longer than 5 minutes
  // (QUEUE_HEARTBEAT_TIMEOUT_MS) is falsely marked stalled even though the
  // Python worker is actively emitting progress events. This was the root
  // cause of large-document graph extraction (e.g. 597 chunks) silently
  // timing out after 3 retry attempts.
  const heartbeatTimeoutMs = Number(process.env.QUEUE_HEARTBEAT_TIMEOUT_MS) || 5 * 60 * 1000;
  return {
    progress: Math.max(0, Math.min(99, progress)),
    heartbeatAt: now,
    leaseExpiresAt: new Date(now.getTime() + heartbeatTimeoutMs * 2),
    resultData: JSON.stringify({
      stage: typeof event.stage === "string" ? event.stage : "indexing",
      message: typeof event.message === "string" ? event.message : "Indexing knowledge graph",
      processed: typeof event.processed === "number" ? event.processed : undefined,
      total: typeof event.total === "number" ? event.total : undefined,
      lastHeartbeatAt: now.toISOString(),
    }),
  };
}

export function buildGraphRetryOutcome(
  errorType: GraphErrorType,
  attempt: number,
  retryInMs: number,
  retryTaskId: string,
  retryNotBefore: Date,
): WorkerResult {
  return cancelledOutcome(
    `Graph attempt ${attempt + 1} failed (${errorType}), retrying in ${Math.round(retryInMs / 1000)}s`,
    {
      indexMode: "graph",
      graphStatus: "retrying",
      errorType,
      attempt: attempt + 1,
      nextAttempt: attempt + 1,
      retryInMs,
      retryTaskId,
      retryNotBefore: retryNotBefore.toISOString(),
    },
  );
}

export async function persistGraphRetry(input: {
  taskId: string;
  docId: string;
  userId: string;
  attempt: number;
  retryNotBefore: Date;
}): Promise<string> {
  const payload = {
    docId: input.docId,
    retryNotBefore: input.retryNotBefore.toISOString(),
    options: { indexMode: "graph" as const, [ATTEMPT_KEY]: input.attempt + 1 },
  };
  const identity = await resolveTaskIdentity({
    type: "rag_index",
    payload,
    userId: input.userId,
    options: { parentTaskId: input.taskId, attempt: input.attempt + 1 },
  });
  const retryTaskId = uuidv4();
  await db.asyncTask.create({
    data: {
      id: retryTaskId,
      userId: input.userId,
      type: "rag_index",
      status: "pending",
      progress: 0,
      inputData: JSON.stringify(payload),
      ...identity,
    },
  });
  return retryTaskId;
}

interface GraphIndexResult {
  status?: string;
  chunks?: number;
  committed_chunks?: number;
  expected_chunks?: number;
  timeoutOccurred?: boolean;
  error?: string;
}

export function assertGraphIndexCommitted(result: GraphIndexResult | undefined): void {
  if (!result || result.status !== "indexed") {
    throw new Error(result?.error || `LightRAG graph index did not commit (status: ${result?.status || "missing"})`);
  }

  const committed = result.committed_chunks ?? result.chunks;
  const expected = result.expected_chunks ?? result.chunks;
  if (typeof committed !== "number" || typeof expected !== "number" || committed !== expected) {
    throw new Error(`LightRAG graph index committed ${String(committed)}/${String(expected)} chunks`);
  }
}

export async function processDocumentGraph(taskId: string, ctx: TaskExecutionContext): Promise<WorkerResult> {
  const procCtx = await loadProcessingTask(taskId, ctx.signal);
  await resolveProcessingModels(procCtx);

  // The attempt counter is stashed in inputData by retries (1st run has none → 0).
  const attempt = typeof (procCtx.options as Record<string, unknown> | undefined)?.[ATTEMPT_KEY] === "number"
    ? Number((procCtx.options as Record<string, unknown>)[ATTEMPT_KEY])
    : 0;

  // Check if document still exists before starting graph extraction
  const currentDoc = await db.document.findUnique({ where: { id: procCtx.docId } });
  if (!currentDoc || currentDoc.status === "failed") {
    return cancelledOutcome("Document no longer exists", { ok: false }, 0);
  }

  procCtx.options.indexMode = "graph";

  try {
    await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { progress: 20 },
    });

    const indexResult = await indexDocument(procCtx, async (event) => {
      await db.asyncTask.updateMany({
        where: { id: taskId, status: "running" },
        data: buildGraphTaskProgressUpdate(event),
      });
    }, taskId);

    // Surface timeout explicitly at the top level of resultData so it's visible
    // in diagnostics without digging into the nested rag.error string. The graph
    // worker still soft-lands (doc ready, basic search usable) on any failure.
    const ragResult = indexResult?.rag as GraphIndexResult | undefined;
    const graphTimedOut = ragResult?.status === "failed" && !!ragResult?.timeoutOccurred;
    if (graphTimedOut) {
      console.warn(`[graph] doc ${procCtx.docId} extraction TIMED OUT (soft-landing as ready):`, ragResult?.error);
    }
    assertGraphIndexCommitted(ragResult);
    ctx.throwIfCancelled();

    // Graph extraction is the FINAL pipeline stage. The embed worker left the
    // document in "indexing_graph" awaiting us, so only here — once the
    // knowledge graph is built — does the document become truly ready.
    // (LightRAG soft-failures are non-blocking: basic indexing already
    // succeeded, so the doc is usable and "ready" is correct.)
    await db.document.update({
      where: { id: procCtx.docId },
      data: { status: "ready" },
    }).catch(() => {});

    // NOTE: Wiki synthesis is now triggered by rag-embed-index-worker right
    // after basic index completes (parallel with graph), NOT here. Wiki and
    // graph are independent — both only need chunks, neither needs the other.

    return {
      ok: true,
      rag: indexResult?.rag,
      indexMode: indexResult?.indexMode,
      graphStatus: "indexed",
      timeoutOccurred: graphTimedOut || undefined,
    };
  } catch (error) {
    ctx.throwIfCancelled();
    return handleGraphFailure(taskId, procCtx.docId, procCtx.doc.userId, error, attempt);
  }
}

/**
 * Failure policy: a graph failure must NEVER brick the document. By this
 * stage DB embeddings + FTS already succeeded, so basic search is available.
 *
 *   retryable + attempts remain  → persist pending successor with a due time
 *   otherwise                    → soft-land: doc ready + warning, task completed
 *
 * The task is marked "completed" (not "failed") on soft-land because the
 * document IS usable; the failure is recorded in resultData + conversionWarning
 * for transparency and to drive a UI retry affordance.
 */
async function handleGraphFailure(
  taskId: string,
  docId: string,
  userId: string,
  error: unknown,
  attempt: number,
): Promise<WorkerResult> {
  const classified = classifyGraphError(error);

  // Retry path: persist a fresh pending rag_index before this attempt ends.
  // The queue derives eligibility from retryNotBefore, so restart loses only an
  // optional wake timer, never the retry itself. The current task is cancelled.
  if (classified.retryable && attempt < GRAPH_MAX_RETRIES) {
    const delay = graphRetryDelay(attempt);
    const retryNotBefore = new Date(Date.now() + delay);
    const retryTaskId = await persistGraphRetry({ taskId, docId, userId, attempt, retryNotBefore });

    console.warn(
      `[graph] doc ${docId} attempt ${attempt + 1} failed (${classified.type}); retry ${attempt + 2}/${GRAPH_MAX_RETRIES + 1} in ${Math.round(delay / 1000)}s`,
      error instanceof Error ? error.message : error,
    );
    return buildGraphRetryOutcome(classified.type, attempt, delay, retryTaskId, retryNotBefore);
  }

  // Final failure — soft-land. The document stays usable via DB embedding + FTS.
  const warning = graphFailureWarning(classified.type, classified.retryable);
  const before = await db.document.findUnique({
    where: { id: docId },
    select: { conversionWarning: true },
  }).catch(() => null);
  await db.document.update({
    where: { id: docId },
    data: {
      status: "ready",
      conversionWarning: appendWarning(before?.conversionWarning ?? null, warning),
    },
  }).catch(() => {});

  console.warn(
    `[graph] doc ${docId} graph extraction failed permanently (${classified.type}); soft-landing as ready with warning`,
    error instanceof Error ? error.message : error,
  );

  return completedOutcome({
    indexMode: "graph",
    graphStatus: "failed",
    errorType: classified.type as GraphErrorType,
    retryable: classified.retryable,
    attempts: attempt + 1,
  } satisfies GraphFailureResult);
}

/** resultData shape persisted on final graph failure (consumed by the status API + UI). */
export interface GraphFailureResult {
  indexMode: "graph";
  graphStatus: "failed";
  errorType: GraphErrorType;
  retryable: boolean;
  attempts: number;
}

function appendWarning(existing: string | null, warning: string): string {
  return existing ? `${existing}\n${warning}` : warning;
}
