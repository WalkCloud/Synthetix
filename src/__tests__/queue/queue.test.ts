import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskQueue } from "@/lib/queue/queue";
import type { WorkerFn, TaskResult } from "@/lib/queue/types";
import { db } from "@/lib/db";

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
      async (_payload, onProgress) => {
        onProgress(25);
        onProgress(50);
        onProgress(75);
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
