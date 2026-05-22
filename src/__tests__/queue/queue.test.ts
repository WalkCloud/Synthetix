import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskQueue } from "@/lib/queue/queue";
import type { WorkerFn, TaskResult } from "@/lib/queue/types";
import { db } from "@/lib/db";

const TEST_USER_ID = "test-queue-user";

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

    // Clean up test tasks created in previous tests
    await db.asyncTask.deleteMany({
      where: { userId: TEST_USER_ID },
    });
  });

  it("should submit a task and return an ID", async () => {
    queue.registerWorker("document_upload", async () => ({ ok: true }));

    const taskId = await queue.submit(
      "document_upload",
      { filename: "test.pdf" },
      TEST_USER_ID,
    );

    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe("string");
    expect(taskId.length).toBeGreaterThan(0);

    const info = await queue.getStatus(taskId);
    expect(info).not.toBeNull();
    expect(info!.type).toBe("document_upload");
    expect(info!.status).toBeDefined();
  });

  it("should execute a task and mark it completed", async () => {
    const workerFn = vi.fn<WorkerFn>(
      async () => ({ converted: true }),
    );
    queue.registerWorker("document_convert", workerFn);

    const taskId = await queue.submit(
      "document_convert",
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
    queue.registerWorker("rag_index", workerFn);

    const taskId = await queue.submit("rag_index", {}, TEST_USER_ID);

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
    queue.registerWorker("chapter_generate", workerFn);

    const taskId = await queue.submit(
      "chapter_generate",
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
      taskTimeoutMs: { draft_generate_all: 1000 },
    });
    longTaskQueue.registerWorker("draft_generate_all", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { generated: true };
    });

    const taskId = await longTaskQueue.submit(
      "draft_generate_all",
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
    cancelQueue.registerWorker("chapter_summarize", async () => workerPromise as Promise<TaskResult>);

    // First task fills the concurrency slot (it blocks)
    await cancelQueue.submit("chapter_summarize", {}, TEST_USER_ID);

    // Second task stays pending because concurrency is 1
    const taskId = await cancelQueue.submit(
      "chapter_summarize",
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

  it("should mark task as failed when no worker is registered", async () => {
    const taskId = await queue.submit(
      "outline_generate",
      {},
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
    expect(info!.error).toContain("No worker registered");
  });

  it("should drain pending tasks on startup", async () => {
    const drainQueue = new TaskQueue({ concurrency: 2, timeoutMs: 5000 });
    let completedCount = 0;
    drainQueue.registerWorker("document_convert", async () => {
      completedCount++;
      return { ok: true };
    });

    const id1 = await drainQueue.submit("document_convert", { file: "a" }, TEST_USER_ID);
    const id2 = await drainQueue.submit("document_convert", { file: "b" }, TEST_USER_ID);

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
        type: "document_convert",
        status: "running",
        progress: 50,
        inputData: "{}",
      },
    });

    let workerCalled = false;
    rescueQueue.registerWorker("document_convert", async () => {
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
});
