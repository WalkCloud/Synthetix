import { db } from "@/lib/db";
import { documentLifecycle } from "@/lib/documents/lifecycle";

export async function cleanupDeletedDocument(taskId: string): Promise<{ ok: boolean; result?: unknown }> {
  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 10 },
  });

  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Cleanup task not found: ${taskId}`);

  const payload = task.inputData ? JSON.parse(task.inputData) as { docId?: string } : {};
  if (!payload.docId) throw new Error("Missing docId in document cleanup task");

  await db.asyncTask.update({ where: { id: taskId }, data: { progress: 25 } });
  const result = await documentLifecycle.cleanupDeletedDocument(task.userId, payload.docId);

  await db.asyncTask.update({
    where: { id: taskId },
    data: {
      status: "completed",
      progress: 100,
      resultData: JSON.stringify(result),
    },
  });

  return { ok: true, result };
}
