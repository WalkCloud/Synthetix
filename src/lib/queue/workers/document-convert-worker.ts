import { db } from "@/lib/db";
import { runPhaseOne } from "@/lib/documents/phase1";
import {
  assertLatestDocumentConvertTask,
  SupersededDocumentProcessingTaskError,
} from "@/lib/documents/processing-tasks";
import { cancelledOutcome, type ProcessingOptions, type WorkerResult } from "@/lib/queue/types";
import { compareTaskIdentitySources } from "@/lib/queue/task-identity-legacy";

export function buildConvertTaskProgressUpdate(
  event: Record<string, unknown>,
  now = new Date(),
): { progress: number; resultData: string } {
  const rawProgress = typeof event.progress === "number" ? event.progress : 10;
  const progress = Math.max(5, Math.min(99, rawProgress));
  return {
    progress,
    resultData: JSON.stringify({
      stage: typeof event.stage === "string" ? event.stage : "converting",
      message: typeof event.message === "string" ? event.message : "Converting document",
      processed: typeof event.processed === "number" ? event.processed : undefined,
      total: typeof event.total === "number" ? event.total : undefined,
      lastHeartbeatAt: now.toISOString(),
    }),
  };
}

export async function processDocumentConvert(
  taskId: string,
): Promise<WorkerResult> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Task ${taskId} not found`);

  let docId: string | undefined = compareTaskIdentitySources(task).authoritative.documentId ?? undefined;
  let userId = task.userId;
  let options: ProcessingOptions = {};
  try {
    const input = JSON.parse(task.inputData || "{}");
    if (!docId) docId = input.docId as string | undefined;
    options = (input.options as ProcessingOptions) ?? {};
  } catch {
    /* fall through to validation below */
  }
  if (!docId) throw new Error("Missing docId in document_convert task input");

  // Bail out cheaply if a newer document_convert task has already been
  // submitted for the same docId. The newer one will rebuild from scratch
  // anyway, so doing the work here is wasted effort and risks racing the
  // newer run on the same chunk rows.
  await assertLatestDocumentConvertTask(userId, docId, taskId);

  try {
    await runPhaseOne(docId, options, async (event) => {
      await db.asyncTask.updateMany({
        where: { id: taskId, status: "running" },
        data: buildConvertTaskProgressUpdate(event),
      });
    }, taskId);
    return { ok: true, docId };
  } catch (error) {
    if (error instanceof SupersededDocumentProcessingTaskError) {
      return cancelledOutcome(
        "Superseded by newer document processing task",
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
