import { describe, expect, it, vi } from "vitest";
import { DocumentMutationBusyError, ExecutionRegistry } from "@/lib/queue/execution-registry";

describe("ExecutionRegistry", () => {
  it("tracks the real worker promise until it settles", async () => {
    const registry = new ExecutionRegistry();
    let resolveWorker: (value: { ok: boolean }) => void = () => {};
    const worker = registry.startDocumentExecution({
      taskId: "task-1",
      taskType: "document_convert",
      userId: "user-1",
      docId: "doc-1",
      start: () => new Promise((resolve) => { resolveWorker = resolve; }),
    });

    await vi.waitFor(async () => expect(await registry.hasActiveExecution("user-1", "doc-1")).toBe(true));
    let mutationStarted = false;
    const mutation = registry.withDocumentMutation("user-1", ["doc-1"], async () => {
      await registry.awaitDocumentExecutions("user-1", ["doc-1"]);
      mutationStarted = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mutationStarted).toBe(false);
    resolveWorker({ ok: true });
    await worker;
    await mutation;
    expect(mutationStarted).toBe(true);
    expect(await registry.hasActiveExecution("user-1", "doc-1")).toBe(false);
  });

  it("prevents a same-document worker from starting while mutation gate is held", async () => {
    const registry = new ExecutionRegistry();
    let releaseMutation: () => void = () => {};
    const held = new Promise<void>((resolve) => { releaseMutation = resolve; });
    let workerStarted = false;

    const mutation = registry.withDocumentMutation("user-1", ["doc-1"], async () => held);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = registry.startDocumentExecution({
      taskId: "task-1",
      taskType: "document_convert",
      userId: "user-1",
      docId: "doc-1",
      start: async () => {
        workerStarted = true;
        return { ok: true };
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(workerStarted).toBe(false);
    releaseMutation();
    await mutation;
    await worker;
    expect(workerStarted).toBe(true);
  });

  it("does not block a different document or user", async () => {
    const registry = new ExecutionRegistry();
    let releaseMutation: () => void = () => {};
    const held = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const mutation = registry.withDocumentMutation("user-1", ["doc-1"], async () => held);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(registry.startDocumentExecution({
      taskId: "task-doc-2",
      taskType: "document_convert",
      userId: "user-1",
      docId: "doc-2",
      start: async () => ({ ok: true }),
    })).resolves.toEqual({ ok: true });
    await expect(registry.startDocumentExecution({
      taskId: "task-user-2",
      taskType: "document_convert",
      userId: "user-2",
      docId: "doc-1",
      start: async () => ({ ok: true }),
    })).resolves.toEqual({ ok: true });

    releaseMutation();
    await mutation;
  });

  it("fails closed when real execution does not settle before timeout", async () => {
    const registry = new ExecutionRegistry();
    void registry.startDocumentExecution({
      taskId: "task-1",
      taskType: "rag_index",
      userId: "user-1",
      docId: "doc-1",
      start: () => new Promise(() => {}),
    });
    await vi.waitFor(async () => expect(await registry.hasActiveExecution("user-1", "doc-1")).toBe(true));

    await expect(registry.withDocumentMutation("user-1", ["doc-1"], async () => {
      await registry.awaitDocumentExecutions("user-1", ["doc-1"], { timeoutMs: 10 });
    })).rejects.toBeInstanceOf(DocumentMutationBusyError);
  });

  it("can exclude the cleanup task itself from the barrier", async () => {
    const registry = new ExecutionRegistry();
    let resolveCleanup: (value: { ok: boolean }) => void = () => {};
    const cleanup = registry.startDocumentExecution({
      taskId: "cleanup-1",
      taskType: "document_cleanup",
      userId: "user-1",
      docId: "doc-1",
      start: () => new Promise((resolve) => { resolveCleanup = resolve; }),
    });
    await vi.waitFor(async () => expect(await registry.hasActiveExecution("user-1", "doc-1")).toBe(true));

    await expect(registry.awaitDocumentExecutions("user-1", ["doc-1"], {
      excludeTaskId: "cleanup-1",
      timeoutMs: 10,
    })).resolves.toBeUndefined();

    resolveCleanup({ ok: true });
    await cleanup;
  });
});
