import { TaskQueue } from "./queue";
import { processDocument } from "./workers/document-worker";
import { generateDraftAll } from "./workers/draft-worker";
import type { TaskPayload, TaskResult } from "./types";

let queue: TaskQueue | null = null;

const LONG_DRAFT_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours

export function getQueue(): TaskQueue {
  if (!queue) {
    queue = new TaskQueue({
      concurrency: 1,
      timeoutMs: 30 * 60 * 1000,
      taskTimeoutMs: {
        draft_generate_all: LONG_DRAFT_TIMEOUT_MS,
      },
    });

    queue.registerWorker("document_convert", async (
      payload: TaskPayload,
      _onProgress: (progress: number) => void,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      if (!taskId) throw new Error("Missing taskId in payload");
      await processDocument(taskId);
      return { ok: true };
    });

    queue.registerWorker("draft_generate_all", async (
      payload: TaskPayload,
      onProgress: (progress: number) => void,
    ): Promise<TaskResult> => {
      const taskId = payload.taskId as string;
      const draftId = payload.draftId as string;
      const userId = payload.userId as string;
      if (!taskId || !draftId || !userId) {
        throw new Error("Missing required draft generation payload");
      }
      return generateDraftAll(
        {
          ...payload,
          taskId,
          draftId,
          userId,
        },
        onProgress,
      );
    });
  }
  return queue;
}
