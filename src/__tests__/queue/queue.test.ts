import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskQueue } from "@/lib/queue/queue";
import { cancelledOutcome, completedOutcome, failedOutcome, type WorkerFn, type TaskResult } from "@/lib/queue/types";
import { db } from "@/lib/db";
import { executionRegistry } from "@/lib/queue/execution-registry";

const TEST_USER_ID = "test-queue-user";

// Unique task type prefixes to prevent cross-test pollution.
// The production queue (getQueue) and other test files register workers
// for types like "document_convert" and "rag_index". Using _test_ prefixed
// types ensures our TaskQueue instances only ever pick up their own tasks.
const TEST_TYPE_UPLOAD = "_test_upload";
const TEST_TYPE_CONVERT = "_test_convert";
const TEST_TYPE_RAG_INDEX = "_test_rag_index";
const TEST_TYPE_CHAPTER_GEN = "_test_chapter_gen";
const TEST_TYPE_DRAFT_GEN = "_test_draft_gen";
const TEST_TYPE_CHAPTER_SUM = "_test_chapter_sum";
const TEST_TYPE_DRAIN = "_test_drain_convert";
const TEST_TYPE_ORPHAN = "_test_orphan_convert";
const TEST_TYPE_OUTLINE = "_test_outline_gen";

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeEach(async () => {
    queue = new TaskQueue({ timeoutMs: 2000 });

    // Ensure test user exists (foreign key constraint)
    await db.user.upsert({
      where: { id: TEST_USER_ID },
      create: {
        id: TEST_USER_ID,
        username: "test-queue-user",
        passwordHash: "test-hash",
      },
      update: {},
    });

    // Clean up ALL test-prefixed tasks from previous runs
    await db.asyncTask.deleteMany({
      where: { type: { startsWith: "_test_" } },
    });
  });

  afterEach(async () => {
    // Clean up test-prefixed tasks after each test as well
    await db.asyncTask.deleteMany({
      where: { type: { startsWith: "_test_" } },
    });
  });

  it("should submit a task and return an ID", async () => {
    queue.registerWorker(TEST_TYPE_UPLOAD, async () => ({ ok: true }));

    const taskId = await queue.submit(
      TEST_TYPE_UPLOAD,
      { filename: "test.pdf" },
      TEST_USER_ID,
    );

    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe("string");
    expect(taskId.length).toBeGreaterThan(0);

    const info = await queue.getStatus(taskId);
    expect(info).not.toBeNull();
    expect(info!.type).toBe(TEST_TYPE_UPLOAD);
    expect(info!.status).toBeDefined();

    const stored = await db.asyncTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(JSON.parse(stored.inputData || "{}")).toEqual({ filename: "test.pdf" });
    expect(stored.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(stored.parentTaskId).toBeNull();
    expect(stored.attempt).toBe(0);
  });

  it("dual-writes document identity without changing the legacy payload", async () => {
    const taskType = "_test_dual_write";
    queue.registerWorker(taskType, async () => ({ ok: true }));

    const payload = { docId: "doc-dual-write", options: { indexMode: "graph" } };
    const taskId = await queue.submit(taskType, payload, TEST_USER_ID);
    const stored = await db.asyncTask.findUniqueOrThrow({ where: { id: taskId } });

    expect(stored.documentId).toBe("doc-dual-write");
    expect(stored.draftId).toBeNull();
    expect(stored.sessionId).toBeNull();
    expect(JSON.parse(stored.inputData || "{}")).toEqual(payload);
  });

  it("uses relational document identity before the legacy payload", async () => {
    const taskType = "_test_relational_identity";
    let releaseWorker: (() => void) | undefined;
    queue.registerWorker(taskType, async () => {
      await new Promise<void>((resolve) => { releaseWorker = resolve; });
      return { ok: true };
    });

    const taskId = crypto.randomUUID();
    await db.asyncTask.create({
      data: {
        id: taskId,
        userId: TEST_USER_ID,
        type: taskType,
        inputData: JSON.stringify({ docId: "doc-legacy" }),
        documentId: "doc-relational",
        operationId: crypto.randomUUID(),
        attempt: 0,
      },
    });

    void queue.processNext();
    await vi.waitFor(async () => {
      expect(await executionRegistry.hasActiveExecution(TEST_USER_ID, "doc-relational")).toBe(true);
    });
    expect(await executionRegistry.hasActiveExecution(TEST_USER_ID, "doc-legacy")).toBe(false);

    releaseWorker?.();
    await vi.waitFor(async () => {
      expect((await queue.getStatus(taskId))?.status).toBe("completed");
    });
  });

  it("should execute a task and mark it completed", async () => {
    const workerFn = vi.fn<WorkerFn>(
      async () => ({ converted: true }),
    );
    queue.registerWorker(TEST_TYPE_CONVERT, workerFn);

    const taskId = await queue.submit(
      TEST_TYPE_CONVERT,
      { fileId: "abc123" },
      TEST_USER_ID,
    );

    // Wait for the task to complete
    await vi.waitFor(
      async () => {
        const info = await queue.getStatus(taskId);
        expect(info?.status).toBe("completed");
      },
      { timeout: 3000 },
    );

    const info = await queue.getStatus(taskId);
    expect(info!.progress).toBe(100);
    expect(info!.result).toEqual({ converted: true });
    expect(workerFn).toHaveBeenCalledOnce();
  });

  it("should track progress updates", async () => {
    const workerFn = vi.fn<WorkerFn>(
      async (_payload, ctx) => {
        ctx.reportProgress(25);
        ctx.reportProgress(50);
        ctx.reportProgress(75);
        return { done: true };
      },
    );
    queue.registerWorker(TEST_TYPE_RAG_INDEX, workerFn);

    const taskId = await queue.submit(TEST_TYPE_RAG_INDEX, {}, TEST_USER_ID);

    await vi.waitFor(
      async () => {
        const info = await queue.getStatus(taskId);
        expect(info?.status).toBe("completed");
      },
      { timeout: 3000 },
    );

    const info = await queue.getStatus(taskId);
    expect(info!.progress).toBe(100);
    expect(info!.result).toEqual({ done: true });
  });

  it("should handle worker errors and mark task failed", async () => {
    const workerFn = vi.fn<WorkerFn>(
      async () => {
        throw new Error("Conversion failed: corrupted file");
      },
    );
    queue.registerWorker(TEST_TYPE_CHAPTER_GEN, workerFn);

    const taskId = await queue.submit(
      TEST_TYPE_CHAPTER_GEN,
      { chapterId: "ch1" },
      TEST_USER_ID,
    );

    await vi.waitFor(
      async () => {
        const info = await queue.getStatus(taskId);
        expect(info?.status).toBe("failed");
      },
      { timeout: 3000 },
    );

    const info = await queue.getStatus(taskId);
    expect(info!.error).toBe("Conversion failed: corrupted file");
  });

  it("should honor task-specific timeout overrides", async () => {
    const longTaskQueue = new TaskQueue({
      timeoutMs: 50,
      taskTimeoutMs: { [TEST_TYPE_DRAFT_GEN]: 1000 },
    });
    longTaskQueue.registerWorker(TEST_TYPE_DRAFT_GEN, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { generated: true };
    });

    const taskId = await longTaskQueue.submit(
      TEST_TYPE_DRAFT_GEN,
      {},
      TEST_USER_ID,
    );

    await vi.waitFor(
      async () => {
        const info = await longTaskQueue.getStatus(taskId);
        expect(info?.status).toBe("completed");
      },
      { timeout: 1500 },
    );

    const info = await longTaskQueue.getStatus(taskId);
    expect(info!.result).toEqual({ generated: true });
  });

  it("should cancel a pending task", async () => {
    // Use a single queue with concurrency=1 and a blocking worker
    let resolveWorker: (value: unknown) => void;
    const workerPromise = new Promise((resolve) => {
      resolveWorker = resolve;
    });

    const cancelQueue = new TaskQueue({ concurrency: 1, timeoutMs: 5000 });
    cancelQueue.registerWorker(TEST_TYPE_CHAPTER_SUM, async () => workerPromise as Promise<TaskResult>);

    // First task fills the concurrency slot (it blocks)
    await cancelQueue.submit(TEST_TYPE_CHAPTER_SUM, {}, TEST_USER_ID);

    // Second task stays pending because concurrency is 1
    const taskId = await cancelQueue.submit(
      TEST_TYPE_CHAPTER_SUM,
      {},
      TEST_USER_ID,
    );

    // Verify it is pending
    let info = await cancelQueue.getStatus(taskId);
    expect(info!.status).toBe("pending");

    // Cancel it
    const cancelled = await cancelQueue.cancel(taskId);
    expect(cancelled).toBe(true);

    info = await cancelQueue.getStatus(taskId);
    expect(info!.status).toBe("cancelled");

    // Clean up blocking worker
    resolveWorker!({ done: true });
  });

  it("writes cancel_requested for a running task, then cancelled when the worker resolves", async () => {
    let resolveWorker: (value: TaskResult) => void = () => {};
    const workerStarted = new Promise<void>((resolve) => {
      queue.registerWorker(TEST_TYPE_UPLOAD, async () => {
        resolve();
        return new Promise<TaskResult>((workerResolve) => {
          resolveWorker = workerResolve;
        });
      });
    });

    const taskId = await queue.submit(TEST_TYPE_UPLOAD, {}, TEST_USER_ID);
    await workerStarted;

    // Running cancel transitions to non-terminal cancel_requested (not cancelled yet)
    expect(await queue.cancel(taskId)).toBe(true);
    let info = await queue.getStatus(taskId);
    expect(info!.status).toBe("cancel_requested");

    // Terminal cancelled is written only when the worker Promise settles
    resolveWorker({ late: true });
    await vi.waitFor(async () => {
      expect((await queue.getStatus(taskId))?.status).toBe("cancelled");
    });

    info = await queue.getStatus(taskId);
    expect(info?.result).toBeUndefined();
  });

  it("writes cancel_requested for a running task, then cancelled when the worker rejects", async () => {
    let rejectWorker: (reason: Error) => void = () => {};
    const workerStarted = new Promise<void>((resolve) => {
      queue.registerWorker(TEST_TYPE_UPLOAD, async () => {
        resolve();
        return new Promise<TaskResult>((_workerResolve, workerReject) => {
          rejectWorker = workerReject;
        });
      });
    });

    const taskId = await queue.submit(TEST_TYPE_UPLOAD, {}, TEST_USER_ID);
    await workerStarted;
    expect(await queue.cancel(taskId)).toBe(true);
    expect((await queue.getStatus(taskId))?.status).toBe("cancel_requested");

    rejectWorker(new Error("late failure"));
    await vi.waitFor(async () => {
      expect((await queue.getStatus(taskId))?.status).toBe("cancelled");
    });

    expect((await queue.getStatus(taskId))?.error).not.toBe("late failure");
  });

  it("ignores late worker progress after a hard timeout", async () => {
    const timeoutQueue = new TaskQueue({ timeoutMs: 20 });
    let reportLateProgress: (() => void) | undefined;
    timeoutQueue.registerWorker(TEST_TYPE_UPLOAD, async (_payload, ctx) => {
      reportLateProgress = () => { void ctx.reportProgress(88); };
      return new Promise<TaskResult>(() => {});
    });

    const taskId = await timeoutQueue.submit(TEST_TYPE_UPLOAD, {}, TEST_USER_ID);
    await vi.waitFor(async () => {
      expect((await timeoutQueue.getStatus(taskId))?.status).toBe("failed");
    }, { timeout: 1000 });

    const before = await timeoutQueue.getStatus(taskId);
    reportLateProgress?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await timeoutQueue.getStatus(taskId);

    expect(after?.status).toBe("failed");
    expect(after?.progress).toBe(before?.progress);
    expect(after?.error).toMatch(/timed out/i);
  });

  it("persists explicit worker outcomes without exposing the control envelope", async () => {
    const outcomes = new TaskQueue({ concurrency: 1, timeoutMs: 2000 });
    const completedType = "_test_outcome_completed";
    const failedType = "_test_outcome_failed";
    const cancelledType = "_test_outcome_cancelled";
    outcomes.registerWorker(completedType, async () => completedOutcome({ value: "done" }));
    outcomes.registerWorker(failedType, async () => failedOutcome("handled failure", { value: "partial" }));
    outcomes.registerWorker(cancelledType, async () => cancelledOutcome("superseded", { value: "retry" }));

    const completedId = await outcomes.submit(completedType, {}, TEST_USER_ID);
    const failedId = await outcomes.submit(failedType, {}, TEST_USER_ID);
    const cancelledId = await outcomes.submit(cancelledType, {}, TEST_USER_ID);

    await vi.waitFor(async () => {
      expect((await outcomes.getStatus(completedId))?.status).toBe("completed");
      expect((await outcomes.getStatus(failedId))?.status).toBe("failed");
      expect((await outcomes.getStatus(cancelledId))?.status).toBe("cancelled");
    }, { timeout: 3000 });

    expect((await outcomes.getStatus(completedId))?.result).toEqual({ value: "done" });
    expect((await outcomes.getStatus(failedId))?.result).toEqual({ value: "partial" });
    expect((await outcomes.getStatus(failedId))?.error).toBe("handled failure");
    expect((await outcomes.getStatus(cancelledId))?.result).toEqual({ value: "retry" });
  });

  it("should return null for nonexistent task status", async () => {
    const info = await queue.getStatus("nonexistent-id");
    expect(info).toBeNull();
  });

  it("should return false when cancelling nonexistent task", async () => {
    const result = await queue.cancel("nonexistent-id");
    expect(result).toBe(false);
  });

  it("should reject submit when no worker is registered", async () => {
    await expect(
      queue.submit(TEST_TYPE_OUTLINE, {}, TEST_USER_ID)
    ).rejects.toThrow(`No worker registered for task type: ${TEST_TYPE_OUTLINE}`);
  });

  it("should drain pending tasks on startup", async () => {
    const drainQueue = new TaskQueue({ concurrency: 2, timeoutMs: 5000 });
    let completedCount = 0;
    drainQueue.registerWorker(TEST_TYPE_DRAIN, async () => {
      completedCount++;
      return { ok: true };
    });

    const id1 = await drainQueue.submit(TEST_TYPE_DRAIN, { file: "a" }, TEST_USER_ID);
    const id2 = await drainQueue.submit(TEST_TYPE_DRAIN, { file: "b" }, TEST_USER_ID);

    await vi.waitFor(
      async () => {
        const s1 = await drainQueue.getStatus(id1);
        const s2 = await drainQueue.getStatus(id2);
        expect(s1?.status).toBe("completed");
        expect(s2?.status).toBe("completed");
      },
      { timeout: 3000 },
    );

    expect(completedCount).toBe(2);
  });

  it("should recover orphaned running tasks via drain", async () => {
    const rescueQueue = new TaskQueue({ concurrency: 1, timeoutMs: 5000 });

    await db.asyncTask.create({
      data: {
        id: "orphan-running-1",
        userId: TEST_USER_ID,
        type: TEST_TYPE_ORPHAN,
        status: "running",
        progress: 50,
        inputData: "{}",
      },
    });

    let workerCalled = false;
    rescueQueue.registerWorker(TEST_TYPE_ORPHAN, async () => {
      workerCalled = true;
      return { recovered: true };
    });

    await rescueQueue.drain();

    await vi.waitFor(
      async () => {
        const info = await rescueQueue.getStatus("orphan-running-1");
        expect(info?.status).toBe("completed");
      },
      { timeout: 3000 },
    );

    expect(workerCalled).toBe(true);
    await db.asyncTask.deleteMany({ where: { id: "orphan-running-1" } });
  });

  it("caps a single task type even when global concurrency is higher", async () => {
    const TYPE = "_test_percap_solo";
    const capQueue = new TaskQueue({
      concurrency: 4,
      timeoutMs: 5000,
      taskConcurrency: { [TYPE]: 1 },
    });

    let active = 0;
    let peak = 0;
    let completed = 0;

    capQueue.registerWorker(TYPE, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
      completed += 1;
      return { ok: true };
    });

    await Promise.all(
      Array.from({ length: 5 }, (_, i) => capQueue.submit(TYPE, { i }, TEST_USER_ID)),
    );

    await vi.waitFor(() => expect(completed).toBe(5), { timeout: 8000, interval: 25 });
    expect(peak).toBe(1);
  });

  it("allows different capped types to share the global slot pool", async () => {
    const T_A = "_test_percap_share_a";
    const T_B = "_test_percap_share_b";
    const capQueue = new TaskQueue({
      concurrency: 2,
      timeoutMs: 5000,
      taskConcurrency: { [T_A]: 1, [T_B]: 1 },
    });

    let aActive = 0, bActive = 0;
    let aPeak = 0, bPeak = 0, totalPeak = 0;
    let completed = 0;

    const checkPeak = () => {
      aPeak = Math.max(aPeak, aActive);
      bPeak = Math.max(bPeak, bActive);
      totalPeak = Math.max(totalPeak, aActive + bActive);
    };

    capQueue.registerWorker(T_A, async () => {
      aActive += 1; checkPeak();
      await new Promise((r) => setTimeout(r, 50));
      aActive -= 1;
      completed += 1;
      return { ok: true };
    });
    capQueue.registerWorker(T_B, async () => {
      bActive += 1; checkPeak();
      await new Promise((r) => setTimeout(r, 50));
      bActive -= 1;
      completed += 1;
      return { ok: true };
    });

    await Promise.all([
      ...Array.from({ length: 3 }, (_, i) => capQueue.submit(T_A, { i }, TEST_USER_ID)),
      ...Array.from({ length: 3 }, (_, i) => capQueue.submit(T_B, { i }, TEST_USER_ID)),
    ]);

    await vi.waitFor(() => expect(completed).toBe(6), { timeout: 8000, interval: 25 });
    expect(aPeak).toBe(1);
    expect(bPeak).toBe(1);
    expect(totalPeak).toBe(2);
  });

  // --- recoverOrphanedPhaseOne / resolveRecoveryOptions --------------------
  // Regression: a dev-server hot-reload re-ran recoverOrphanedPhaseOne while a
  // fresh upload's document_convert task was still pending. Recovery resubmitted
  // with options:{}; the supersede guard then cancelled the REAL upload task
  // (it was older) and ran the empty-options one — so indexMode:"graph" was
  // lost and the knowledge-graph phase was never enqueued (empty KG).
  const RECOVERY_TYPE = "document_convert";

  async function createConvertTask(
    docId: string,
    status: string,
    options: Record<string, unknown> = {},
  ): Promise<string> {
    const id = `rcv-${docId}-${Math.random().toString(36).slice(2, 8)}`;
    await db.asyncTask.create({
      data: {
        id,
        userId: TEST_USER_ID,
        type: RECOVERY_TYPE,
        status,
        progress: 0,
        inputData: JSON.stringify({ docId, options }),
      },
    });
    return id;
  }

  it("resolveRecoveryOptions skips a doc that already has a pending convert task", async () => {
    const { resolveRecoveryOptions } = await import("@/lib/queue");
    const docId = "recovery-skip-pending";
    const id = await createConvertTask(docId, "pending", { indexMode: "graph" });
    try {
      const result = await resolveRecoveryOptions(TEST_USER_ID, docId);
      // A live task exists → recovery must NOT race it (returns null = skip).
      expect(result).toBeNull();
    } finally {
      await db.asyncTask.deleteMany({ where: { id } });
    }
  });

  it("resolveRecoveryOptions reuses options from the latest prior convert task", async () => {
    const { resolveRecoveryOptions } = await import("@/lib/queue");
    const docId = "recovery-reuse-options";
    const id = await createConvertTask(docId, "completed", {
      indexMode: "graph",
      splitStrategy: "structure-llm",
    });
    try {
      const result = await resolveRecoveryOptions(TEST_USER_ID, docId);
      expect(result).toEqual({ indexMode: "graph", splitStrategy: "structure-llm" });
    } finally {
      await db.asyncTask.deleteMany({ where: { id } });
    }
  });

  it("resolveRecoveryOptions returns empty options when no prior task exists", async () => {
    const { resolveRecoveryOptions } = await import("@/lib/queue");
    const result = await resolveRecoveryOptions(TEST_USER_ID, "recovery-no-task");
    expect(result).toEqual({});
  });
});

describe("TaskQueue — heartbeat stall detection", () => {
  const TEST_TYPE_HB = "_test_heartbeat";
  let queue: TaskQueue;

  beforeEach(async () => {
    // Short timeout so the test scans a tight window. heartbeatTimeoutMs=60ms
    // means anything older than 60ms without a heartbeat is stalled.
    queue = new TaskQueue({ heartbeatScanIntervalMs: 1000, heartbeatTimeoutMs: 60 });
    await db.user.upsert({
      where: { id: TEST_USER_ID },
      create: { id: TEST_USER_ID, username: "test-queue-user", passwordHash: "x" },
      update: {},
    });
    await db.asyncTask.deleteMany({ where: { type: TEST_TYPE_HB } });
  });

  afterEach(async () => {
    queue.stopHeartbeatScan();
    await db.asyncTask.deleteMany({ where: { type: TEST_TYPE_HB } });
  });

  it("marks a running task failed when its lastHeartbeatAt is stale", async () => {
    // Create a running task with a heartbeat from 10 minutes ago (well past the 60ms cutoff).
    const task = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: TEST_TYPE_HB,
        status: "running",
        progress: 40,
        inputData: "{}",
        heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    // scanHeartbeats is private — access via the instance for testing.
    await (queue as unknown as { scanHeartbeats: () => Promise<void> }).scanHeartbeats();

    const after = await db.asyncTask.findUnique({ where: { id: task.id } });
    expect(after?.status).toBe("failed");
    expect(after?.errorMessage).toMatch(/heartbeat timeout/i);
  });

  it("does NOT fail a running task with a fresh heartbeat", async () => {
    const task = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: TEST_TYPE_HB,
        status: "running",
        progress: 55,
        inputData: "{}",
        heartbeatAt: new Date(),
      },
    });

    await (queue as unknown as { scanHeartbeats: () => Promise<void> }).scanHeartbeats();

    const after = await db.asyncTask.findUnique({ where: { id: task.id } });
    expect(after?.status).toBe("running");
  });

  it("falls back to updatedAt when heartbeatAt is null", async () => {
    // A task that just started (no heartbeat yet) — updatedAt is recent, so it
    // must NOT be falsely marked stalled.
    const task = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: TEST_TYPE_HB,
        status: "running",
        progress: 0,
        inputData: "{}",
      },
    });

    await (queue as unknown as { scanHeartbeats: () => Promise<void> }).scanHeartbeats();

    const after = await db.asyncTask.findUnique({ where: { id: task.id } });
    expect(after?.status).toBe("running");

    // But if updatedAt is ancient, it SHOULD be failed (no heartbeat + no recent claim).
    await db.asyncTask.update({
      where: { id: task.id },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await (queue as unknown as { scanHeartbeats: () => Promise<void> }).scanHeartbeats();
    const after2 = await db.asyncTask.findUnique({ where: { id: task.id } });
    expect(after2?.status).toBe("failed");
  });

  it("startHeartbeatScan is idempotent and stopHeartbeatScan clears the timer", () => {
    expect(queue.startHeartbeatScan.bind(queue)).not.toThrow();
    queue.startHeartbeatScan(); // second call — no-op, no second timer
    queue.stopHeartbeatScan();
    // After stop, starting again should work fresh.
    expect(queue.startHeartbeatScan.bind(queue)).not.toThrow();
    queue.stopHeartbeatScan();
  });
});
