import { db } from "@/lib/db";
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

/** Attempt count is carried in task inputData so a re-enqueued retry knows its index. */
const ATTEMPT_KEY = "_graphAttempt";

export function buildGraphTaskProgressUpdate(
  event: Record<string, unknown>,
  now = new Date(),
): { progress: number; resultData: string } {
  const progress = typeof event.progress === "number" ? event.progress : 20;
  return {
    progress: Math.max(0, Math.min(99, progress)),
    resultData: JSON.stringify({
      stage: typeof event.stage === "string" ? event.stage : "indexing",
      message: typeof event.message === "string" ? event.message : "Indexing knowledge graph",
      processed: typeof event.processed === "number" ? event.processed : undefined,
      total: typeof event.total === "number" ? event.total : undefined,
      lastHeartbeatAt: now.toISOString(),
    }),
  };
}

export async function processDocumentGraph(taskId: string): Promise<{ ok: boolean; rag?: unknown; indexMode?: string }> {
  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 5 },
  });

  const ctx = await loadProcessingTask(taskId);
  await resolveProcessingModels(ctx);

  // The attempt counter is stashed in inputData by retries (1st run has none → 0).
  const attempt = typeof (ctx.options as Record<string, unknown> | undefined)?.[ATTEMPT_KEY] === "number"
    ? Number((ctx.options as Record<string, unknown>)[ATTEMPT_KEY])
    : 0;

  // Check if document still exists before starting graph extraction
  const currentDoc = await db.document.findUnique({ where: { id: ctx.docId } });
  if (!currentDoc || currentDoc.status === "failed") {
    await db.asyncTask.update({
      where: { id: taskId },
      data: { status: "cancelled", errorMessage: "Document no longer exists", progress: 0 },
    });
    return { ok: false };
  }

  ctx.options.indexMode = "graph";

  try {
    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 20 },
    });

    const indexResult = await indexDocument(ctx, async (event) => {
      await db.asyncTask.update({
        where: { id: taskId },
        data: buildGraphTaskProgressUpdate(event),
      });
    });

    // Surface timeout explicitly at the top level of resultData so it's visible
    // in diagnostics without digging into the nested rag.error string. The graph
    // worker still soft-lands (doc ready, basic search usable) on any failure.
    const ragResult = indexResult?.rag as { status?: string; timeoutOccurred?: boolean; error?: string } | undefined;
    const graphTimedOut = ragResult?.status === "failed" && !!ragResult?.timeoutOccurred;
    if (graphTimedOut) {
      console.warn(`[graph] doc ${ctx.docId} extraction TIMED OUT (soft-landing as ready):`, ragResult?.error);
    }

    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        progress: 100,
        resultData: JSON.stringify({
          ...(indexResult || { indexMode: "graph" }),
          timeoutOccurred: graphTimedOut || undefined,
        }),
      },
    });

    // Graph extraction is the FINAL pipeline stage. The embed worker left the
    // document in "indexing_graph" awaiting us, so only here — once the
    // knowledge graph is built — does the document become truly ready.
    // (LightRAG soft-failures are non-blocking: basic indexing already
    // succeeded, so the doc is usable and "ready" is correct.)
    await db.document.update({
      where: { id: ctx.docId },
      data: { status: "ready" },
    }).catch(() => {});

    // NOTE: Wiki synthesis is now triggered by rag-embed-index-worker right
    // after basic index completes (parallel with graph), NOT here. Wiki and
    // graph are independent — both only need chunks, neither needs the other.

    return { ok: true, rag: indexResult?.rag, indexMode: indexResult?.indexMode };
  } catch (error) {
    return handleGraphFailure(taskId, ctx.docId, ctx.doc.userId, error, attempt);
  }
}

/**
 * Failure policy: a graph failure must NEVER brick the document. By this
 * stage DB embeddings + FTS already succeeded, so basic search is available.
 *
 *   retryable + attempts remain  → re-enqueue self after backoff
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
): Promise<{ ok: false; rag?: unknown; indexMode?: string }> {
  const classified = classifyGraphError(error);

  // Retry path: re-enqueue a fresh rag_index carrying the incremented attempt.
  // The current task is marked cancelled so it doesn't linger as "failed".
  if (classified.retryable && attempt < GRAPH_MAX_RETRIES) {
    const delay = graphRetryDelay(attempt);
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "cancelled",
        errorMessage: `Graph attempt ${attempt + 1} failed (${classified.type}), retrying in ${Math.round(delay / 1000)}s`,
        resultData: JSON.stringify({
          indexMode: "graph",
          graphStatus: "retrying",
          errorType: classified.type,
          attempt: attempt + 1,
          retryInMs: delay,
        }),
      },
    }).catch(() => undefined);

    setTimeout(() => {
      void import("@/lib/queue").then(({ getQueue }) =>
        getQueue().submit(
          "rag_index",
          { docId, options: { indexMode: "graph", [ATTEMPT_KEY]: attempt + 1 } },
          userId,
        ),
      ).catch((err) => console.warn(`[graph] failed to re-enqueue retry for doc ${docId}:`, err));
    }, delay);

    console.warn(
      `[graph] doc ${docId} attempt ${attempt + 1} failed (${classified.type}); retry ${attempt + 2}/${GRAPH_MAX_RETRIES + 1} in ${Math.round(delay / 1000)}s`,
      error instanceof Error ? error.message : error,
    );
    return { ok: false };
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

  await db.asyncTask.update({
    where: { id: taskId },
    data: {
      status: "completed",
      progress: 100,
      resultData: JSON.stringify({
        indexMode: "graph",
        graphStatus: "failed",
        errorType: classified.type as GraphErrorType,
        retryable: classified.retryable,
        attempts: attempt + 1,
      } satisfies GraphFailureResult),
    },
  }).catch(() => undefined);

  console.warn(
    `[graph] doc ${docId} graph extraction failed permanently (${classified.type}); soft-landing as ready with warning`,
    error instanceof Error ? error.message : error,
  );

  // NOTE: deliberately do NOT re-throw. The queue would mark the task
  // "failed" and overwrite our "completed" soft-land. The document is usable.
  return { ok: false };
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
