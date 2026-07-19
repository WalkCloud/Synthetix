import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { TaskQueue } from "@/lib/queue/queue";
import {
  assertGraphIndexCommitted,
  buildGraphRetryOutcome,
  buildGraphTaskProgressUpdate,
  persistGraphRetry,
} from "@/lib/queue/workers/document-graph-worker";

describe("buildGraphTaskProgressUpdate", () => {
  it("converts Python progress events into async task updates", () => {
    const update = buildGraphTaskProgressUpdate(
      { type: "progress", stage: "indexing", progress: 55, message: "Extracting entities", processed: 5, total: 20 },
      new Date("2026-06-08T00:00:00.000Z"),
    );

    expect(update.progress).toBe(55);
    expect(JSON.parse(update.resultData)).toEqual({
      stage: "indexing",
      message: "Extracting entities",
      processed: 5,
      total: 20,
      lastHeartbeatAt: "2026-06-08T00:00:00.000Z",
    });
  });
});

describe("buildGraphRetryOutcome", () => {
  it("records the persisted retry task instead of a transient scheduled marker", () => {
    const retryNotBefore = new Date("2026-06-08T00:00:30.000Z");
    const outcome = buildGraphRetryOutcome("network", 0, 30_000, "retry-task-id", retryNotBefore);

    expect(outcome.status).toBe("cancelled");
    expect(outcome.result).toMatchObject({
      graphStatus: "retrying",
      errorType: "network",
      attempt: 1,
      nextAttempt: 1,
      retryInMs: 30_000,
      retryTaskId: "retry-task-id",
      retryNotBefore: "2026-06-08T00:00:30.000Z",
    });
    expect(outcome.result).not.toHaveProperty("retryScheduled");
  });
});

const RETRY_USER_ID = "test-graph-retry-user";
const RETRY_DOC_ID = "test-graph-retry-doc";

describe("persistGraphRetry", () => {
  beforeEach(async () => {
    await db.user.upsert({
      where: { id: RETRY_USER_ID },
      create: { id: RETRY_USER_ID, username: RETRY_USER_ID, passwordHash: "test-hash" },
      update: {},
    });
    await db.asyncTask.deleteMany({ where: { userId: RETRY_USER_ID } });
  });

  it("immediately creates a durable pending successor with lineage and due time", async () => {
    const parent = await db.asyncTask.create({
      data: {
        id: "graph-retry-parent",
        userId: RETRY_USER_ID,
        type: "rag_index",
        status: "running",
        inputData: JSON.stringify({ docId: RETRY_DOC_ID, options: { indexMode: "graph" } }),
        documentId: RETRY_DOC_ID,
        operationId: "graph-retry-operation",
        attempt: 0,
      },
    });
    const retryNotBefore = new Date(Date.now() + 60_000);

    const retryId = await persistGraphRetry({
      taskId: parent.id,
      docId: RETRY_DOC_ID,
      userId: RETRY_USER_ID,
      attempt: 0,
      retryNotBefore,
    });

    const retry = await db.asyncTask.findUniqueOrThrow({ where: { id: retryId } });
    expect(retry.status).toBe("pending");
    expect(retry.parentTaskId).toBe(parent.id);
    expect(retry.operationId).toBe(parent.operationId);
    expect(retry.attempt).toBe(1);
    expect(retry.startedAt).toBeNull();
    expect(JSON.parse(retry.inputData || "{}")).toMatchObject({
      docId: RETRY_DOC_ID,
      retryNotBefore: retryNotBefore.toISOString(),
      options: { indexMode: "graph", _graphAttempt: 1 },
    });
  });

  it("survives a new queue and is claimed only after its persisted due time", async () => {
    const type = "_test_graph_retry_due";
    const retryNotBefore = new Date(Date.now() + 200);
    const task = await db.asyncTask.create({
      data: {
        userId: RETRY_USER_ID,
        type,
        status: "pending",
        inputData: JSON.stringify({ retryNotBefore: retryNotBefore.toISOString() }),
        operationId: "graph-retry-restart-operation",
        attempt: 1,
      },
    });
    const worker = vi.fn(async () => ({ ok: true }));
    const restartedQueue = new TaskQueue({ concurrency: 1, timeoutMs: 2_000 });
    restartedQueue.registerWorker(type, worker);

    await restartedQueue.drain();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const beforeDue = await db.asyncTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(beforeDue.status).toBe("pending");
    expect(beforeDue.startedAt).toBeNull();
    expect(worker).not.toHaveBeenCalled();

    await vi.waitFor(async () => {
      expect((await db.asyncTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("completed");
    }, { timeout: 2_000 });
    expect(worker).toHaveBeenCalledOnce();
  });
});

describe("assertGraphIndexCommitted", () => {
  it("accepts a fully committed index result", () => {
    expect(() => assertGraphIndexCommitted({
      status: "indexed",
      chunks: 2,
      committed_chunks: 2,
      expected_chunks: 2,
    })).not.toThrow();
  });

  it.each([
    undefined,
    { status: "failed", error: "duplicate" },
    { status: "skipped" },
    { status: "indexed", committed_chunks: 1, expected_chunks: 2 },
  ])("rejects an uncommitted graph result", (result) => {
    expect(() => assertGraphIndexCommitted(result)).toThrow();
  });
});
