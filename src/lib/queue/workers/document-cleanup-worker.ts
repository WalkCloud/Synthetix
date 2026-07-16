import { db } from "@/lib/db";
import { documentLifecycle } from "@/lib/documents/lifecycle";

export async function cleanupDeletedDocument(taskId: string): Promise<{ ok: boolean; result?: unknown }> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Cleanup task not found: ${taskId}`);

  const payload = task.inputData ? JSON.parse(task.inputData) as { docId?: string } : {};
  if (!payload.docId) throw new Error("Missing docId in document cleanup task");

  await db.asyncTask.updateMany({
    where: { id: taskId, status: "running" },
    data: { progress: 25 },
  });
  const result = await documentLifecycle.cleanupDeletedDocument(task.userId, payload.docId, taskId);
  return { ok: true, result };
}
