import { describe, it, expect, vi } from "vitest";
import { createDocumentLifecycleService, type DocumentLifecycleDeps } from "@/lib/documents/lifecycle";

function createDeps(options?: { remainingDocuments?: number }) {
  const events: string[] = [];
  const document = { id: "doc-1", userId: "user-1" };
  const deps = {
    withDocumentMutation: (async <T>(
      _userId: string,
      _docIds: string[],
      mutate: () => Promise<T>,
    ): Promise<T> => {
      events.push("acquire-gate");
      try {
        return await mutate();
      } finally {
        events.push("release-gate");
      }
    }) as DocumentLifecycleDeps["withDocumentMutation"],
    awaitDocumentExecutions: vi.fn(async () => { events.push("await-executions"); }),
    findDocument: vi.fn(async () => document),
    findDocuments: vi.fn(async (userId: string, docIds: string[]) =>
      docIds.map((id) => ({ id, userId })),
    ),
    countDocuments: vi.fn(async () => options?.remainingDocuments ?? 0),
    cancelDocumentTasks: vi.fn(async () => { events.push("cancel-tasks"); }),
    cancelDocumentTasksBatch: vi.fn(async () => { events.push("cancel-tasks-batch"); }),
    enqueueDocumentCleanup: vi.fn(async () => { events.push("enqueue-cleanup"); return "cleanup-task-1"; }),
    deleteRagDocument: vi.fn(async () => { events.push("delete-rag-doc"); }),
    resetUserRag: vi.fn(async () => { events.push("reset-rag"); }),
    cleanupRagOrphans: vi.fn(async () => { events.push("cleanup-orphans"); }),
    deleteDocumentFiles: vi.fn(async () => { events.push("delete-files"); }),
    deleteDocumentRows: vi.fn(async () => { events.push("delete-db"); }),
    deleteDocumentRowsBatch: vi.fn(async (_userId: string, docIds: string[]) => {
      events.push("delete-db-batch");
      return { deleted: docIds, notFound: [] as string[] };
    }),
    verifyDocumentDeleted: vi.fn(async () => { events.push("verify"); return { ok: true, issues: [] }; }),
  };
  return { deps, events };
}

describe("DocumentLifecycleService", () => {
  it("returns after DB-visible deletion and enqueues heavy cleanup", async () => {
    const { deps, events } = createDeps({ remainingDocuments: 0 });
    const service = createDocumentLifecycleService(deps);

    const result = await service.deleteDocument("user-1", "doc-1");

    expect(result).toEqual({
      deleted: "doc-1",
      cleanup: {
        database: "deleted",
        files: "queued",
        rag: "queued",
        verification: "deferred",
      },
      issues: [],
      cleanupTaskId: "cleanup-task-1",
    });
    expect(events).toEqual([
      "acquire-gate",
      "cancel-tasks",
      "await-executions",
      "delete-db",
      "enqueue-cleanup",
      "release-gate",
    ]);
    expect(deps.findDocument).toHaveBeenCalledWith("user-1", "doc-1");
    expect(deps.deleteRagDocument).not.toHaveBeenCalled();
    expect(deps.deleteDocumentFiles).not.toHaveBeenCalled();
    expect(deps.enqueueDocumentCleanup).toHaveBeenCalledWith("user-1", "doc-1");
  });

  it("runs heavy cleanup separately and resets RAG when no documents remain", async () => {
    const { deps, events } = createDeps({ remainingDocuments: 0 });
    const service = createDocumentLifecycleService(deps);

    const result = await service.cleanupDeletedDocument("user-1", "doc-1");

    expect(result.cleanup.rag).toBe("reset");
    expect(result.cleanup.files).toBe("deleted");
    expect(events).toEqual([
      "acquire-gate",
      "cancel-tasks",
      "await-executions",
      "delete-rag-doc",
      "delete-files",
      "reset-rag",
      "verify",
      "release-gate",
    ]);
  });

  it("does not fail the delete response when cleanup enqueue fails after DB deletion", async () => {
    const { deps } = createDeps({ remainingDocuments: 1 });
    deps.enqueueDocumentCleanup.mockRejectedValueOnce(new Error("queue offline"));
    const service = createDocumentLifecycleService(deps);

    const result = await service.deleteDocument("user-1", "doc-1");

    expect("notFound" in result).toBe(false);
    if ("notFound" in result) throw new Error("expected deletion result");
    expect(result.cleanup.database).toBe("deleted");
    expect(result.cleanup.files).toBe("queued");
    expect(result.issues).toEqual(["Cleanup queued failed: queue offline"]);
  });

  it("queues cleanup without resetting user RAG during request when other documents remain", async () => {
    const { deps } = createDeps({ remainingDocuments: 2 });
    const service = createDocumentLifecycleService(deps);

    const result = await service.deleteDocument("user-1", "doc-1");

    expect("notFound" in result).toBe(false);
    if ("notFound" in result) throw new Error("expected deletion result");
    expect(result.cleanup.rag).toBe("queued");
    expect(deps.resetUserRag).not.toHaveBeenCalled();
  });

  it("cleanup does not reset user RAG when other documents remain", async () => {
    const { deps } = createDeps({ remainingDocuments: 2 });
    const service = createDocumentLifecycleService(deps);

    const result = await service.cleanupDeletedDocument("user-1", "doc-1");

    expect(result.cleanup.rag).toBe("deleted");
    expect(deps.resetUserRag).not.toHaveBeenCalled();
  });

  it("fails closed before deleting rows when an execution does not settle", async () => {
    const { deps } = createDeps();
    deps.awaitDocumentExecutions.mockRejectedValueOnce(new Error("document busy"));
    const service = createDocumentLifecycleService(deps);

    await expect(service.deleteDocument("user-1", "doc-1")).rejects.toThrow("document busy");
    expect(deps.deleteDocumentRows).not.toHaveBeenCalled();
    expect(deps.enqueueDocumentCleanup).not.toHaveBeenCalled();
  });

  it("returns not found without deleting resources", async () => {
    const { deps } = createDeps();
    deps.findDocument.mockResolvedValueOnce(null as never);
    const service = createDocumentLifecycleService(deps);

    const result = await service.deleteDocument("user-1", "missing-doc");

    expect(result).toEqual({ deleted: null, notFound: true });
    expect(deps.deleteDocumentRows).not.toHaveBeenCalled();
    expect(deps.deleteDocumentFiles).not.toHaveBeenCalled();
    expect(deps.deleteRagDocument).not.toHaveBeenCalled();
    expect(deps.enqueueDocumentCleanup).not.toHaveBeenCalled();
  });

  it("deletes multiple documents in a single bulk DB operation", async () => {
    const { deps, events } = createDeps({ remainingDocuments: 0 });
    const service = createDocumentLifecycleService(deps);

    const result = await service.deleteDocuments("user-1", ["doc-1", "doc-2"]);

    expect(result.deleted).toEqual(["doc-1", "doc-2"]);
    // Bulk path: ONE deleteDocumentRowsBatch call (not per-doc findDocument +
    // deleteDocumentRows loops). Cleanup tasks still enqueue per-doc for the
    // background RAG/file cleanup worker.
    expect(deps.deleteDocumentRowsBatch).toHaveBeenCalledTimes(1);
    expect(deps.deleteDocumentRowsBatch).toHaveBeenCalledWith("user-1", ["doc-1", "doc-2"]);
    expect(deps.cancelDocumentTasksBatch).toHaveBeenCalledTimes(1);
    expect(deps.findDocument).not.toHaveBeenCalled();
    expect(deps.deleteDocumentRows).not.toHaveBeenCalled();
    expect(deps.enqueueDocumentCleanup).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      "acquire-gate",
      "cancel-tasks-batch",
      "await-executions",
      "delete-db-batch",
      "enqueue-cleanup",
      "enqueue-cleanup",
      "release-gate",
    ]);
  });
});
