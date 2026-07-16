import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { Semaphore } from "@/lib/concurrency/limiter";
import { parseTaskResult, parseTaskInput } from "@/lib/queue/task-json";
import type {
  TaskType,
  TaskPayload,
  TaskResult,
  TaskInfo,
  WorkerFn,
  WorkerOutcome,
} from "./types";
import { isWorkerOutcome } from "./types";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/** Scan for heartbeat-stalled tasks every 2 minutes by default. */
const DEFAULT_HEARTBEAT_SCAN_INTERVAL_MS = 2 * 60 * 1000;
/** A running task with no heartbeat for 5 minutes is considered stalled.
 *  Mirrors the LLM fetch timeout (5 min) — if a worker hasn't written any
 *  progress in one full fetch-timeout window, the underlying LLM call is
 *  almost certainly hung (e.g. provider holding the connection open). */
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;

interface QueueOptions {
  concurrency?: number;
  timeoutMs?: number | null;
  taskTimeoutMs?: Partial<Record<TaskType, number | null>>;
  taskConcurrency?: Partial<Record<TaskType, number>>;
  /** How often (ms) to scan for heartbeat-stalled running tasks. */
  heartbeatScanIntervalMs?: number;
  /** A running task whose lastHeartbeatAt is older than this (ms) is marked
   *  failed. Defends against zombie workers (e.g. LLM provider holds a
   *  connection open forever) — without it, a stuck task blocks its type's
   *  concurrency slot until the 4h hard timeout. */
  heartbeatTimeoutMs?: number;
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
  // Heartbeat-stall scanner: periodically marks running tasks with no recent
  // lastHeartbeatAt as failed, so a zombie worker (e.g. an LLM provider that
  // holds a connection open without replying) can't pin a concurrency slot
  // until the 4h hard timeout. Null until startHeartbeatScan() is called.
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatScanIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.taskTimeoutMs = options.taskTimeoutMs ?? {};
    this.taskConcurrency = options.taskConcurrency ?? {};
    this.heartbeatScanIntervalMs = options.heartbeatScanIntervalMs ?? DEFAULT_HEARTBEAT_SCAN_INTERVAL_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
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
      info.result = parseTaskResult<TaskResult>(task.resultData, null as unknown as TaskResult);
    }

    if (task.errorMessage) {
      info.error = task.errorMessage;
    }

    return info;
  }

  async cancel(taskId: string): Promise<boolean> {
    const cancelled = await db.asyncTask.updateMany({
      where: {
        id: taskId,
        status: { in: ["pending", "running"] },
      },
      data: {
        status: "cancelled",
        updatedAt: new Date(),
      },
    });
    return cancelled.count === 1;
  }

  /**
   * Start a periodic scan that fails running tasks whose lastHeartbeatAt (in
   * resultData JSON) is older than heartbeatTimeoutMs. This catches zombie
   * workers — e.g. an LLM provider that holds a TCP connection open without
   * ever replying — which would otherwise pin a concurrency slot until the 4h
   * hard timeout. Idempotent: calling twice is a no-op.
   *
   * lastHeartbeatAt is a JSON field inside resultData (not a DB column), so we
   * can't filter via updateMany — we fetch running rows, parse JSON in JS, and
   * mark matched ids failed. Tasks without a lastHeartbeatAt (e.g. a task that
   * just started and hasn't emitted progress yet) are judged by updatedAt
   * instead, so a freshly-claimed task isn't falsely failed.
   */
  startHeartbeatScan(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.scanHeartbeats().catch((err) => {
        // Best-effort — a scan failure must never crash the queue loop.
        console.warn("[queue] heartbeat scan failed:", err);
      });
    }, this.heartbeatScanIntervalMs);
    // Don't keep the process alive just for the scanner (Next.js dev/server
    // manages its own lifecycle). unref is safe in Node; in edge runtimes the
    // timer simply isn't unref'd.
    if (typeof this.heartbeatTimer.unref === "function") {
      this.heartbeatTimer.unref();
    }
  }

  stopHeartbeatScan(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async scanHeartbeats(): Promise<void> {
    const cutoff = Date.now() - this.heartbeatTimeoutMs;
    const cutoffDate = new Date(cutoff);
    // Fetch running tasks. We can't filter on the JSON lastHeartbeatAt in SQL,
    // so we fetch and parse in JS. Limit to a sane batch to bound work.
    const running = await db.asyncTask.findMany({
      where: { status: "running" },
      select: { id: true, type: true, resultData: true, updatedAt: true },
      take: 200,
    });
    const stalled: string[] = [];
    for (const t of running) {
      // Prefer lastHeartbeatAt from resultData; fall back to updatedAt (so a
      // task that hasn't emitted its first progress event yet is judged by its
      // claim time, not falsely considered stalled).
      let lastBeat = t.updatedAt;
      if (t.resultData) {
        const parsed = parseTaskResult<{ lastHeartbeatAt?: string } | null>(t.resultData, null);
        if (parsed?.lastHeartbeatAt) {
          const parsedDate = new Date(parsed.lastHeartbeatAt);
          if (Number.isFinite(parsedDate.getTime())) lastBeat = parsedDate;
        }
      }
      if (lastBeat.getTime() < cutoff) {
        stalled.push(t.id);
      }
    }
    if (stalled.length === 0) return;
    const elapsed = Math.round(this.heartbeatTimeoutMs / 1000);
    const failed = await db.asyncTask.updateMany({
      where: { id: { in: stalled }, status: "running" },
      data: {
        status: "failed",
        errorMessage: `Task heartbeat timeout — no activity for ${elapsed}s`,
        updatedAt: new Date(),
      },
    });
    console.warn(`[queue] marked ${failed.count} stalled task(s) as failed (no heartbeat for ${elapsed}s)`);
    // Re-kick the queue so a pending successor (or the doc's recovery path)
    // can pick up after the zombie is cleared.
    for (let i = 0; i < this.concurrency; i++) {
      void this.processNext();
    }
    void cutoffDate; // referenced for clarity; cutoff is what gates lastBeat
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

  private async commitOutcome(taskId: string, outcome: WorkerOutcome): Promise<void> {
    const data = outcome.status === "completed"
      ? {
          status: "completed" as const,
          progress: 100,
          resultData: JSON.stringify(outcome.result),
          errorMessage: null,
          updatedAt: new Date(),
        }
      : outcome.status === "failed"
        ? {
            status: "failed" as const,
            progress: outcome.progress ?? 100,
            resultData: outcome.result ? JSON.stringify(outcome.result) : undefined,
            errorMessage: outcome.error,
            updatedAt: new Date(),
          }
        : {
            status: "cancelled" as const,
            progress: outcome.progress,
            resultData: outcome.result ? JSON.stringify(outcome.result) : undefined,
            errorMessage: outcome.error ?? null,
            updatedAt: new Date(),
          };

    const committed = await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data,
    });
    if (committed.count === 0) {
      console.warn(`[queue] task ${taskId} already reached a terminal state; ignored late ${outcome.status} outcome`);
    }
  }

  private async executeTask(
    taskId: string,
    taskType: TaskType,
    inputData: string | null,
  ): Promise<void> {
    const workerFn = this.workers.get(taskType);

    if (!workerFn) {
      await db.asyncTask.updateMany({
        where: { id: taskId, status: "running" },
        data: {
          status: "failed",
          errorMessage: `No worker registered for task type: ${taskType}`,
          updatedAt: new Date(),
        },
      });
      return;
    }

    const payload: TaskPayload = {
      ...parseTaskInput<Partial<TaskPayload>>(inputData, {}),
      taskId,
    } as TaskPayload;

    const currentTask = await db.asyncTask.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    if (currentTask?.status !== "running") {
      return;
    }

    const onProgress = async (progress: number): Promise<void> => {
      const clipped = Math.max(0, Math.min(100, progress));
      await db.asyncTask.updateMany({
        where: { id: taskId, status: "running" },
        data: {
          progress: clipped,
          updatedAt: new Date(),
        },
      });
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const resultPromise = workerFn(payload, onProgress);
      const timeoutMs = this.getTimeoutMs(taskType);
      const result = timeoutMs === null
        ? await resultPromise
        : await Promise.race([
            resultPromise,
            new Promise<never>((_resolve, reject) => {
              timeoutId = setTimeout(() => {
                reject(new Error(`Task timed out after ${timeoutMs}ms`));
              }, timeoutMs);
            }),
          ]);

      await this.commitOutcome(
        taskId,
        isWorkerOutcome(result)
          ? result
          : { workerOutcome: true, status: "completed", result },
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      try {
        await this.commitOutcome(taskId, {
          workerOutcome: true,
          status: "failed",
          error: errorMessage,
        });
      } catch {
        // Task record may have been deleted (e.g. test cleanup)
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}
