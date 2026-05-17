import { TaskQueue } from "./queue";
import { processDocument } from "./workers/document-worker";
import type { TaskPayload, TaskResult } from "./types";

let queue: TaskQueue | null = null;

export function getQueue(): TaskQueue {
  if (!queue) {
    queue = new TaskQueue({ concurrency: 1, timeoutMs: 30 * 60 * 1000 });

    queue.registerWorker("document_convert", async (
      payload: TaskPayload,
      _onProgress: (progress: number) => void,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      await processDocument(taskId);
      return { ok: true };
    });
  }
  return queue;
}
