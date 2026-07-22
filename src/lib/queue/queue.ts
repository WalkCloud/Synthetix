import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { Semaphore } from "@/lib/concurrency/limiter";
import { parseTaskResult, parseTaskInput } from "@/lib/queue/task-json";
import type {
  TaskType,
  TaskPayload,
  TaskResult,
  TaskInfo,
  TaskExecutionContext,
  WorkerFn,
  WorkerOutcome,
  SubmitTaskOptions,
} from "./types";
import { isWorkerOutcome } from "./types";
import { executionRegistry } from "./execution-registry";
import { resolveTaskIdentity } from "./task-identity";

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
  private readonly abortControllers = new Map<string, AbortController>();
  private dueTaskTimer: ReturnType<typeof setTimeout> | null = null;
  private dueTaskTimerAt: number | null = null;

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

  private retryNotBefore(inputData: string | null): number | null {
    const value = parseTaskInput<{ retryNotBefore?: unknown }>(inputData, {}).retryNotBefore;
    if (typeof value !== "string") return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private scheduleDueTaskWake(at: number): void {
    if (at <= Date.now()) {
      void this.processNext();
      return;
    }
    if (this.dueTaskTimer && this.dueTaskTimerAt !== null && this.dueTaskTimerAt <= at) return;
    if (this.dueTaskTimer) clearTimeout(this.dueTaskTimer);
    this.dueTaskTimerAt = at;
    this.dueTaskTimer = setTimeout(() => {
      this.dueTaskTimer = null;
      this.dueTaskTimerAt = null;
      void this.processNext();
    }, Math.max(0, at - Date.now()));
    if (typeof this.dueTaskTimer.unref === "function") this.dueTaskTimer.unref();
  }

  async drain(): Promise<void> {
    // Lease-aware restart recovery: only recover tasks whose lease has expired
    // (or was never set). Tasks with a valid unexpired lease are left alone —
    // their worker is likely still running in a sibling process. Tasks with
    // cancel_requested are transitioned to cancelled (the cancel intent
    // survives restart).
    const now = new Date();

    // Cancel-intent tasks from a crashed process go straight to cancelled.
    await db.asyncTask.updateMany({
      where: { status: "cancel_requested" },
      data: { status: "cancelled", finishedAt: now, updatedAt: now },
    });

    // Recover running tasks whose lease has expired or was never set. A task
    // with a valid lease stays running — it may be owned by a concurrent process.
    await db.asyncTask.updateMany({
      where: {
        status: "running",
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "pending",
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      },
    });

    for (let i = 0; i < this.concurrency; i++) {
      void this.processNext();
    }
  }

  async submit(
    type: TaskType,
    payload: TaskPayload,
    userId: string,
    options?: SubmitTaskOptions,
  ): Promise<string> {
    if (!this.workers.has(type)) {
      throw new Error(`No worker registered for task type: ${type}`);
    }

    const id = uuidv4();
    const identity = await resolveTaskIdentity({ type, payload, userId, options });

    await db.asyncTask.create({
      data: {
        id,
        userId,
        type,
        status: "pending",
        progress: 0,
        inputData: JSON.stringify(payload),
        ...identity,
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
    // Pending tasks have no live worker — flip straight to terminal cancelled.
    const pendingCancel = await db.asyncTask.updateMany({
      where: { id: taskId, status: "pending" },
      data: {
        status: "cancelled",
        cancelRequestedAt: new Date(),
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    });
    if (pendingCancel.count === 1) return true;

    // Running tasks have a live worker — request cancel non-terminally and
    // trigger the abort. The terminal `cancelled` is written only when the
    // real worker Promise settles in commitOutcome. This prevents a still-
    // running worker from mutating side effects after the task already shows
    // `cancelled`.
    const runningCancel = await db.asyncTask.updateMany({
      where: { id: taskId, status: "running" },
      data: {
        status: "cancel_requested",
        cancelRequestedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    if (runningCancel.count === 1) {
      this.abortControllers.get(taskId)?.abort();
      return true;
    }

    // Bulk cancellation marks running rows cancel_requested before delegating
    // here. Treat that state as an actionable request so the live controller is
    // still aborted; commitOutcome owns the terminal cancelled transition.
    const cancelRequested = await db.asyncTask.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    if (cancelRequested?.status === "cancel_requested") {
      this.abortControllers.get(taskId)?.abort();
      return true;
    }
    return false;
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
      where: { status: { in: ["running", "cancel_requested"] } },
      select: { id: true, type: true, heartbeatAt: true, updatedAt: true },
      take: 200,
    });
    const stalled: string[] = [];
    for (const t of running) {
      // Prefer the heartbeatAt column; fall back to updatedAt (so a task that
      // hasn't emitted its first progress event yet is judged by its claim
      // time, not falsely considered stalled).
      let lastBeat = t.updatedAt;
      if (t.heartbeatAt && t.heartbeatAt.getTime() > 0) {
        lastBeat = t.heartbeatAt;
      }
      if (lastBeat.getTime() < cutoff) {
        stalled.push(t.id);
      }
    }
    if (stalled.length === 0) return;
    const elapsed = Math.round(this.heartbeatTimeoutMs / 1000);
    const failed = await db.asyncTask.updateMany({
      where: { id: { in: stalled }, status: { in: ["running", "cancel_requested"] } },
      data: {
        status: "failed",
        errorMessage: `Task heartbeat timeout — no activity for ${elapsed}s`,
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    });
    console.warn(`[queue] marked ${failed.count} stalled task(s) as failed (no heartbeat for ${elapsed}s)`);
    // Abort the underlying Python writer for each stalled task so it releases
    // the per-user mutation lock and stops mutating the shared RAG workspace.
    // Without this abort, a stalled-but-still-running daemon holds the lock
    // (its PID is alive, so the lock is not reclaimable) and blocks every
    // other writer for that user until its own op timeout fires.
    //
    // NOTE: With the auto-heartbeat timer in executeTask, reaching this point
    // means the task's Node process itself stalled (not just the Python worker)
    // — a genuine crash or event-loop freeze. The auto-heartbeat (60s interval)
    // prevents the common case where a worker simply forgot to emit progress.
    for (const stalledId of stalled) {
      const stalledTask = running.find((t) => t.id === stalledId);
      console.warn(
        `[queue] stalled task ${stalledId.substring(0, 8)} (type=${stalledTask?.type ?? "?"}, ` +
        `userId=${stalledTask ? "present" : "?"}) — aborting controller`,
      );
      this.abortControllers.get(stalledId)?.abort();
    }
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
    let claimedTask: {
      id: string;
      type: TaskType;
      user_id: string;
      input_data: string | null;
      document_id: string | null;
      operation_id: string | null;
      attempt: number | null;
      execution_generation: number | null;
    } | null = null;
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

      const pending = await db.asyncTask.findMany({
        where: { status: "pending", type: { in: eligibleTypes } },
        select: { id: true, inputData: true },
        orderBy: { createdAt: "asc" },
      });
      const nowMs = Date.now();
      const eligibleTaskIds: string[] = [];
      let nextDueAt: number | null = null;
      for (const task of pending) {
        const notBefore = this.retryNotBefore(task.inputData);
        if (notBefore !== null && notBefore > nowMs) {
          nextDueAt = nextDueAt === null ? notBefore : Math.min(nextDueAt, notBefore);
          continue;
        }
        eligibleTaskIds.push(task.id);
      }
      if (nextDueAt !== null) this.scheduleDueTaskWake(nextDueAt);
      if (eligibleTaskIds.length === 0) return;

      // Atomic claim: try to update a due pending task to "running" in a single query.
      // SQLite serialises the UPDATE so two concurrent processNext() calls cannot
      // claim the same row. Due filtering is derived from persisted inputData above;
      // the wake timer is only an optimisation and drain() reconstructs it.
      const placeholders = eligibleTaskIds.map(() => "?").join(", ");
      const leaseOwner = `${process.pid}-${crypto.randomUUID()}`;
      const leaseExpiry = new Date(Date.now() + this.heartbeatTimeoutMs * 2);
      const claimed = await db.$queryRawUnsafe<{
        id: string;
        type: string;
        user_id: string;
        input_data: string | null;
        document_id: string | null;
        operation_id: string | null;
        attempt: number | null;
        execution_generation: number | null;
      }[]>(
        `UPDATE async_tasks
         SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?,
             lease_owner = ?, lease_expires_at = ?,
             execution_generation = COALESCE(execution_generation, 0) + 1
         WHERE id = (
           SELECT id FROM async_tasks
           WHERE status = 'pending' AND id IN (${placeholders})
           ORDER BY created_at ASC
           LIMIT 1
         ) AND status = 'pending'
         RETURNING id, type, user_id, input_data, document_id, operation_id, attempt, execution_generation`,
        new Date(),
        new Date(),
        leaseOwner,
        leaseExpiry,
        ...eligibleTaskIds,
      );

      if (!claimed || claimed.length === 0) {
        return;
      }

      const task = claimed[0];
      const taskType = task.type as TaskType;
      this.activeCount += 1;
      this.activePerType.set(taskType, (this.activePerType.get(taskType) ?? 0) + 1);
      claimedTask = {
        id: task.id,
        type: taskType,
        user_id: task.user_id,
        input_data: task.input_data,
        document_id: task.document_id,
        operation_id: task.operation_id,
        attempt: task.attempt,
        execution_generation: task.execution_generation,
      };
    } finally {
      release();
    }

    if (!claimedTask) return;

    try {
      await this.executeTask(
        claimedTask.id,
        claimedTask.type,
        claimedTask.user_id,
        claimedTask.input_data,
        claimedTask.document_id,
        claimedTask.operation_id,
        claimedTask.attempt ?? 0,
        claimedTask.execution_generation ?? 1,
      );
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

  private async commitOutcome(taskId: string, outcome: WorkerOutcome, executionGeneration?: number): Promise<void> {
    const data = outcome.status === "completed"
      ? {
          status: "completed" as const,
          progress: 100,
          resultData: JSON.stringify(outcome.result),
          errorMessage: null,
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        }
      : outcome.status === "failed"
        ? {
            status: "failed" as const,
            progress: outcome.progress ?? 100,
            resultData: outcome.result ? JSON.stringify(outcome.result) : undefined,
            errorMessage: outcome.error,
            finishedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          }
        : {
            status: "cancelled" as const,
            progress: outcome.progress,
            resultData: outcome.result ? JSON.stringify(outcome.result) : undefined,
            errorMessage: outcome.error ?? null,
            finishedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          };

    // Match both `running` (nominal) and `cancel_requested` (the non-terminal
    // state written by cancel() for a running task). When executionGeneration
    // is provided, fence: a stale worker from an older generation must not
    // overwrite a newer generation's terminal state.
    const committed = await db.asyncTask.updateMany({
      where: {
        id: taskId,
        status: { in: ["running", "cancel_requested"] },
        ...(executionGeneration !== undefined ? { executionGeneration } : {}),
      },
      data,
    });
    if (committed.count === 0) {
      console.warn(`[queue] task ${taskId} already reached a terminal state; ignored late ${outcome.status} outcome`);
    }
  }

  private async executeTask(
    taskId: string,
    taskType: TaskType,
    userId: string,
    inputData: string | null,
    documentId: string | null,
    operationId: string | null,
    attempt: number,
    executionGeneration: number,
  ): Promise<void> {
    const workerFn = this.workers.get(taskType);

    if (!workerFn) {
      await db.asyncTask.updateMany({
        where: { id: taskId, status: "running" },
        data: {
          status: "failed",
          errorMessage: `No worker registered for task type: ${taskType}`,
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return;
    }

    const parsedPayload = parseTaskInput<Partial<TaskPayload>>(inputData, {});
    const payload: TaskPayload = {
      ...parsedPayload,
      taskId,
    } as TaskPayload;
    const docId = documentId ?? (
      typeof parsedPayload.docId === "string" && parsedPayload.docId.length > 0
        ? parsedPayload.docId
        : null
    );

    const currentTask = await db.asyncTask.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    if (currentTask?.status !== "running") {
      // Was cancelled (→ cancel_requested) between claim and execution start.
      // No worker Promise exists to settle, so finalize the cancellation here.
      if (currentTask?.status === "cancel_requested") {
        await this.commitOutcome(taskId, {
          workerOutcome: true,
          status: "cancelled",
          error: "Cancelled by user",
        }, executionGeneration);
      }
      return;
    }

    // One AbortController per execution. cancel() triggers abort(); the worker
    // Promise then settles and commitOutcome writes the terminal state.
    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);

    const reportProgress = async (progress: number): Promise<void> => {
      const clipped = Math.max(0, Math.min(100, progress));
      await db.asyncTask.updateMany({
        where: { id: taskId, status: { in: ["running", "cancel_requested"] } },
        data: {
          progress: clipped,
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + this.heartbeatTimeoutMs * 2),
          updatedAt: new Date(),
        },
      });
    };

    const heartbeat = async (): Promise<void> => {
      await db.asyncTask.updateMany({
        where: { id: taskId, status: { in: ["running", "cancel_requested"] } },
        data: {
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + this.heartbeatTimeoutMs * 2),
          updatedAt: new Date(),
        },
      });
    };

    const ctx: TaskExecutionContext = {
      taskId,
      taskType,
      userId,
      operationId: operationId ?? undefined,
      attempt,
      signal: controller.signal,
      reportProgress,
      heartbeat,
      throwIfCancelled: () => {
        if (controller.signal.aborted) {
          throw new Error("Task was cancelled");
        }
      },
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    // Auto-heartbeat: periodically refresh heartbeatAt for ANY running task,
    // regardless of whether the worker remembers to call ctx.heartbeat().
    // This is the architectural safety net that prevents the 5-minute heartbeat
    // scanner (scanHeartbeats) from falsely killing long-running tasks whose
    // workers don't emit progress events (e.g. embed batches stuck on a slow
    // provider, or a purge iterating 3000+ entities). 60s << 5min threshold.
    // Workers that DO call ctx.heartbeat/reportProgress simply write more
    // often — the auto-heartbeat is additive, never conflicting.
    const autoHeartbeat = setInterval(async () => {
      await db.asyncTask.updateMany({
        where: { id: taskId, status: { in: ["running", "cancel_requested"] } },
        data: {
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + this.heartbeatTimeoutMs * 2),
        },
      }).catch(() => {});
    }, 60_000);
    if (typeof autoHeartbeat.unref === "function") autoHeartbeat.unref();

    try {
      const startWorker = () => workerFn(payload, ctx);
      const { workerPromise: resultPromise } = await executionRegistry.startExecution({
        taskId,
        taskType,
        userId: docId ? userId : undefined,
        docId: docId ?? undefined,
        start: startWorker,
      });
      const timeoutMs = this.getTimeoutMs(taskType);
      const result = timeoutMs === null
        ? await resultPromise
        : await Promise.race([
            resultPromise,
            new Promise<never>((_resolve, reject) => {
              timeoutId = setTimeout(() => {
                // Mark this as a timeout (not a user cancel) so the catch
                // block records `failed` with the timeout message, while still
                // aborting the underlying Python writer (daemon tree / spawn
                // tree) so the timed-out task releases the per-user mutation
                // lock and stops mutating the shared RAG workspace. Without
                // this abort, the timed-out Python process keeps running (up
                // to 4h for a graph task) holding the lock, blocking every
                // other writer for that user with RAG_MUTATION_BUSY.
                timedOut = true;
                controller.abort();
                reject(new Error(`Task timed out after ${timeoutMs}ms`));
              }, timeoutMs);
            }),
          ]);

      // If cancel was requested while the worker was running, the final
      // outcome is always `cancelled` regardless of what the worker returned.
      // A late success must not un-cancel a task the user asked to abort.
      // (A TIMEOUT also aborts the controller, but is reported as `failed`
      // via the timedOut flag in the catch block below — it is NOT a user
      // cancellation.)
      if (controller.signal.aborted && !timedOut) {
        await this.commitOutcome(taskId, {
          workerOutcome: true,
          status: "cancelled",
          error: "Cancelled by user",
        }, executionGeneration);
      } else {
        await this.commitOutcome(
          taskId,
          isWorkerOutcome(result)
            ? result
            : { workerOutcome: true, status: "completed", result },
          executionGeneration,
        );
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      // A timeout aborts the controller (to kill the writer) but is a FAILURE,
      // not a user cancellation. A genuine user cancel (cancel() path) is the
      // only case that records `cancelled` here.
      const isUserCancel = controller.signal.aborted && !timedOut;
      try {
        await this.commitOutcome(taskId, isUserCancel
          ? { workerOutcome: true, status: "cancelled", error: "Cancelled by user" }
          : { workerOutcome: true, status: "failed", error: errorMessage },
          executionGeneration,
        );
      } catch {
        // Task record may have been deleted (e.g. test cleanup)
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      clearInterval(autoHeartbeat);
      this.abortControllers.delete(taskId);
    }
  }
}
