import { db } from "@/lib/db";
import { documentLifecycle } from "@/lib/documents/lifecycle";
import { compareTaskIdentitySources } from "@/lib/queue/task-identity-legacy";
import type { TaskExecutionContext } from "@/lib/queue/types";

export async function cleanupDeletedDocument(taskId: string, _ctx: TaskExecutionContext): Promise<{ ok: boolean; result?: unknown }> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Cleanup task not found: ${taskId}`);

  const identity = compareTaskIdentitySources(task);
  const docId = identity.authoritative.documentId
    ?? (task.inputData ? (JSON.parse(task.inputData) as { docId?: string }).docId : null);
  if (!docId) throw new Error("Missing docId in document cleanup task");

  await db.asyncTask.updateMany({
    where: { id: taskId, status: "running" },
    data: { progress: 25 },
  });
  const result = await documentLifecycle.cleanupDeletedDocument(task.userId, docId, taskId);
  return { ok: true, result };
}
