import { db } from "@/lib/db";
import { runPhaseOne } from "@/lib/documents/phase1";
import {
  assertLatestDocumentConvertTask,
  SupersededDocumentProcessingTaskError,
} from "@/lib/documents/processing-tasks";
import type { ProcessingOptions } from "@/lib/queue/types";

export async function processDocumentConvert(
  taskId: string,
): Promise<{ ok: boolean; docId?: string; superseded?: boolean }> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Task ${taskId} not found`);

  let docId: string | undefined;
  let userId = task.userId;
  let options: ProcessingOptions = {};
  try {
    const input = JSON.parse(task.inputData || "{}");
    docId = input.docId as string | undefined;
    options = (input.options as ProcessingOptions) ?? {};
  } catch {
    /* fall through to validation below */
  }
  if (!docId) throw new Error("Missing docId in document_convert task input");

  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 5 },
  });

  // Bail out cheaply if a newer document_convert task has already been
  // submitted for the same docId. The newer one will rebuild from scratch
  // anyway, so doing the work here is wasted effort and risks racing the
  // newer run on the same chunk rows.
  await assertLatestDocumentConvertTask(userId, docId, taskId);

  try {
    await runPhaseOne(docId, options);
    return { ok: true, docId };
  } catch (error) {
    if (error instanceof SupersededDocumentProcessingTaskError) {
      return { ok: false, superseded: true };
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
