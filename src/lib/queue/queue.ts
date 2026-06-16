import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { Semaphore } from "@/lib/concurrency/limiter";
import type {
  TaskType,
  TaskPayload,
  TaskResult,
  TaskInfo,
  WorkerFn,
} from "./types";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface QueueOptions {
  concurrency?: number;
  timeoutMs?: number | null;
  taskTimeoutMs?: Partial<Record<TaskType, number | null>>;
  taskConcurrency?: Partial<Record<TaskType, number>>;
}

export class TaskQueue {
  private readonly workers: Map<TaskType, WorkerFn> = new Map();
  private activeCount = 0;
  private readonly concurrency: number;
  private readonly timeoutMs: number | null;
  private readonly taskTimeoutMs: Partial<Record<TaskType, number | null>>;
  private readonly taskConcurrency: Partial<Record<TaskType, number>>;
  private readonly activePerType: Map<TaskType, number> = new Map();
  // Serialises the scheduling section (cap check → SQL claim → counter
  // increment) so concurrent processNext() calls cannot all observe an
  // empty activePerType for the same capped type and over-claim.
  // executeTask itself runs OUTSIDE this lock, so global concurrency
  // is preserved.
  private readonly schedulerLock = new Semaphore(1);

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.taskTimeoutMs = options.taskTimeoutMs ?? {};
    this.taskConcurrency = options.taskConcurrency ?? {};
  }

  registerWorker(type: TaskType, workerFn: WorkerFn): void {
    this.workers.set(type, workerFn);
  }

  async drain(): Promise<void> {
    // Only reset tasks that were running in the last hour — stale tasks
    // from earlier sessions shouldn't be re-executed
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await db.asyncTask.updateMany({
      where: {
        status: "running",
        updatedAt: { gte: oneHourAgo },
      },
      data: { status: "pending", updatedAt: new Date() },
    });

    for (let i = 0; i < this.concurrency; i++) {
      void this.processNext();
    }
  }

  async submit(
    type: TaskType,
    payload: TaskPayload,
    userId: string,
  ): Promise<string> {
    if (!this.workers.has(type)) {
      throw new Error(`No worker registered for task type: ${type}`);
    }

    const id = uuidv4();

    await db.asyncTask.create({
      data: {
        id,
        userId,
        type,
        status: "pending",
        progress: 0,
        inputData: JSON.stringify(payload),
      },
    });

    void this.processNext();

    return id;
  }

  async getStatus(taskId: string): Promise<TaskInfo | null> {
    const task = await db.asyncTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return null;
    }

    const info: TaskInfo = {
      id: task.id,
      type: task.type as TaskType,
      status: task.status as TaskInfo["status"],
      progress: task.progress,
    };

    if (task.resultData) {
      info.result = JSON.parse(task.resultData) as TaskResult;
    }

    if (task.errorMessage) {
      info.error = task.errorMessage;
    }

    return info;
  }

  async cancel(taskId: string): Promise<boolean> {
    const task = await db.asyncTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return false;
    }

    if (task.status === "pending" || task.status === "running") {
      await db.asyncTask.update({
        where: { id: taskId },
        data: {
          status: "cancelled",
          updatedAt: new Date(),
        },
      });
      return true;
    }

    return false;
  }

  private isTypeAtCap(type: TaskType): boolean {
    const cap = this.taskConcurrency[type];
    if (cap == null) return false;
    return (this.activePerType.get(type) ?? 0) >= cap;
  }

  async processNext(): Promise<void> {
    // Scheduling section is serialised. claimedTask is the row we successfully
    // reserved (or null if none was eligible).
    const release = await this.schedulerLock.acquire();
    let claimedTask: { id: string; type: TaskType; input_data: string | null } | null = null;
    try {
      if (this.activeCount >= this.concurrency) {
        return;
      }

      // Filter out task types that have already hit their per-type cap.
      // This lets `rag_index` (graph) and `rag_embed_index` share the global
      // pool without one starving the other.
      const eligibleTypes = [...this.workers.keys()].filter((t) => !this.isTypeAtCap(t));
      if (eligibleTypes.length === 0) {
        return;
      }

      // Atomic claim: try to update a pending task to "running" in a single query.
      // SQLite serialises the UPDATE so two concurrent processNext() calls cannot
      // claim the same row.
      const placeholders = eligibleTypes.map(() => "?").join(", ");
      const claimed = await db.$queryRawUnsafe<{ id: string; type: string; input_data: string | null }[]>(
        `UPDATE async_tasks
         SET status = 'running', updated_at = ?
         WHERE id = (
           SELECT id FROM async_tasks
           WHERE status = 'pending' AND type IN (${placeholders})
           ORDER BY created_at ASC
           LIMIT 1
         ) AND status = 'pending'
         RETURNING id, type, input_data`,
        new Date(),
        ...eligibleTypes,
      );

      if (!claimed || claimed.length === 0) {
        return;
      }

      const task = claimed[0];
      const taskType = task.type as TaskType;
      this.activeCount += 1;
      this.activePerType.set(taskType, (this.activePerType.get(taskType) ?? 0) + 1);
      claimedTask = { id: task.id, type: taskType, input_data: task.input_data };
    } finally {
      release();
    }

    if (!claimedTask) return;

    try {
      await this.executeTask(claimedTask.id, claimedTask.type, claimedTask.input_data);
    } finally {
      const taskType = claimedTask.type;
      // Both decrements happen after executeTask returns; any other waiter
      // will see the freed slot on its next acquire.
      this.activeCount -= 1;
      this.activePerType.set(taskType, Math.max(0, (this.activePerType.get(taskType) ?? 1) - 1));
      // Wake schedulers — first call may pick up the same type we just freed,
      // second call lets a different type take the global slot if needed.
      void this.processNext();
      void this.processNext();
    }
  }

  private getTimeoutMs(taskType: TaskType): number | null {
    if (Object.prototype.hasOwnProperty.call(this.taskTimeoutMs, taskType)) {
      return this.taskTimeoutMs[taskType] ?? null;
    }
    return this.timeoutMs;
  }

  private async executeTask(
    taskId: string,
    taskType: TaskType,
    inputData: string | null,
  ): Promise<void> {
    const workerFn = this.workers.get(taskType);

    if (!workerFn) {
      await db.asyncTask.update({
        where: { id: taskId },
        data: {
          status: "failed",
          errorMessage: `No worker registered for task type: ${taskType}`,
          updatedAt: new Date(),
        },
      });
      return;
    }

    const payload: TaskPayload = {
      ...(inputData ? (JSON.parse(inputData) as TaskPayload) : {}),
      taskId,
    };

    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "running",
        updatedAt: new Date(),
      },
    });

    // Check if task was cancelled before starting work
    const currentTask = await db.asyncTask.findUnique({
      where: { id: taskId },
    });
    if (currentTask?.status === "cancelled") {
      return;
    }

    const onProgress = async (progress: number): Promise<void> => {
      const clipped = Math.max(0, Math.min(100, progress));
      await db.asyncTask.update({
        where: { id: taskId },
        data: {
          progress: clipped,
          updatedAt: new Date(),
        },
      });
    };

    try {
      const resultPromise = workerFn(payload, onProgress);
      const timeoutMs = this.getTimeoutMs(taskType);

      const result = timeoutMs === null
        ? await resultPromise
        : await Promise.race([
            resultPromise,
            new Promise<never>((_resolve, reject) => {
              setTimeout(() => {
                reject(new Error(`Task timed out after ${timeoutMs}ms`));
              }, timeoutMs);
            }),
          ]);

      // Check cancellation after completion
      const finalTask = await db.asyncTask.findUnique({
        where: { id: taskId },
      });
      if (finalTask?.status === "cancelled") {
        return;
      }

      await db.asyncTask.update({
        where: { id: taskId },
        data: {
          status: "completed",
          progress: 100,
          resultData: JSON.stringify(result),
          updatedAt: new Date(),
        },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      try {
        const errorTask = await db.asyncTask.findUnique({
          where: { id: taskId },
        });
        if (errorTask?.status !== "cancelled") {
          await db.asyncTask.update({
            where: { id: taskId },
            data: {
              status: "failed",
              errorMessage,
              updatedAt: new Date(),
            },
          });
        }
      } catch {
        // Task record may have been deleted (e.g. test cleanup)
      }
    }
  }
}
