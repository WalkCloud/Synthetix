import { db } from "@/lib/db";
import { documentLifecycle } from "@/lib/documents/lifecycle";
import { compareTaskIdentitySources } from "@/lib/queue/task-identity-legacy";
import { getQueue } from "@/lib/queue";
import { cancelledOutcome, type TaskExecutionContext, type WorkerResult } from "@/lib/queue/types";

/** Max cleanup retry attempts (in addition to the initial try = 3 total). */
const CLEANUP_MAX_RETRIES = 2;
/** Delay before retrying a failed cleanup task. */
const CLEANUP_RETRY_DELAY_MS = 60_000;

export async function cleanupDeletedDocument(taskId: string, ctx: TaskExecutionContext): Promise<WorkerResult> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Cleanup task not found: ${taskId}`);

  const identity = compareTaskIdentitySources(task);
  const docId = identity.authoritative.documentId
    ?? (task.inputData ? (JSON.parse(task.inputData) as { docId?: string; retryNotBefore?: string }).docId : null);
  if (!docId) throw new Error("Missing docId in document cleanup task");

  // Extract retry attempt from inputData (set by a prior failed retry).
  const parsed = task.inputData ? JSON.parse(task.inputData) as { _cleanupAttempt?: number; retryNotBefore?: string } : {};
  const attempt = parsed._cleanupAttempt ?? 0;

  // Honor retryNotBefore: if the task was scheduled with a delay, the queue
  // already gates execution on it, but double-check here for safety.
  if (parsed.retryNotBefore) {
    const notBefore = new Date(parsed.retryNotBefore);
    if (Date.now() < notBefore.getTime()) {
      const wait = notBefore.getTime() - Date.now();
      throw new Error(`Cleanup retry scheduled for ${notBefore.toISOString()} (in ${Math.round(wait / 1000)}s)`);
    }
  }

  await db.asyncTask.updateMany({
    where: { id: taskId, status: "running" },
    data: { progress: 25 },
  });

  try {
    const result = await documentLifecycle.cleanupDeletedDocument(task.userId, docId, taskId);
    return { ok: true, result };
  } catch (error) {
    // Retry transient failures (timeout, lock contention, provider errors).
    // Cleanup is critical — without it, deleted documents' graph data persists
    // as orphan entities visible in the knowledge graph. Unlike rag_index which
    // has a dedicated retry subsystem, cleanup previously had NO retry at all.
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTransient = /timeout|busy|locked|transient|ECONNRESET|ETIMEDOUT/i.test(errorMessage);

    if (isTransient && attempt < CLEANUP_MAX_RETRIES) {
      const retryNotBefore = new Date(Date.now() + CLEANUP_RETRY_DELAY_MS);
      console.warn(
        `[cleanup] doc ${docId} attempt ${attempt + 1} failed (${errorMessage.substring(0, 80)}); ` +
        `retrying in ${CLEANUP_RETRY_DELAY_MS / 1000}s (attempt ${attempt + 2}/${CLEANUP_MAX_RETRIES + 1})`,
      );
      // Submit a new cleanup task with the retry attempt marker.
      // retryNotBefore is stored in inputData; the queue scheduler reads it
      // to gate execution until the delay expires.
      await getQueue().submit(
        "document_cleanup",
        { docId, _cleanupAttempt: attempt + 1, retryNotBefore: retryNotBefore.toISOString() },
        task.userId,
      ).catch(() => {});
      // Return cancelled so the current task shows as "retried", not "failed".
      return cancelledOutcome(
        `Cleanup attempt ${attempt + 1} failed, retrying in ${CLEANUP_RETRY_DELAY_MS / 1000}s`,
        { retried: true, attempt: attempt + 1 },
      );
    }

    // Non-transient error or max retries exhausted — let it fail so the user
    // sees the error. The orphan sweep on the next cleanup cycle will retry.
    throw error;
  }
}
