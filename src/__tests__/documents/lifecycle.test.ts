import { describe, it, expect, vi } from "vitest";
import { createDocumentLifecycleService } from "@/lib/documents/lifecycle";

function createDeps(options?: { remainingDocuments?: number }) {
  const events: string[] = [];
  const document = { id: "doc-1", userId: "user-1" };
  const deps = {
    findDocument: vi.fn(async () => document),
    countDocuments: vi.fn(async () => options?.remainingDocuments ?? 0),
    cancelDocumentTasks: vi.fn(async () => { events.push("cancel-tasks"); }),
    deleteRagDocument: vi.fn(async () => { events.push("delete-rag-doc"); }),
    resetUserRag: vi.fn(async () => { events.push("reset-rag"); }),
    deleteDocumentFiles: vi.fn(async () => { events.push("delete-files"); }),
    deleteDocumentRows: vi.fn(async () => { events.push("delete-db"); }),
    verifyDocumentDeleted: vi.fn(async () => { events.push("verify"); return { ok: true, issues: [] }; }),
  };
  return { deps, events };
}

describe("DocumentLifecycleService", () => {
  it("deletes document resources in lifecycle order and resets RAG when no documents remain", async () => {
    const { deps, events } = createDeps({ remainingDocuments: 0 });
    const service = createDocumentLifecycleService(deps);

    const result = await service.deleteDocument("user-1", "doc-1");

    expect(result).toEqual({
      deleted: "doc-1",
      cleanup: {
        database: "deleted",
        files: "deleted",
        rag: "reset",
        verification: "passed",
      },
      issues: [],
    });
    expect(events).toEqual([
      "cancel-tasks",
      "delete-rag-doc",
      "delete-files",
      "delete-db",
      "reset-rag",
      "verify",
    ]);
    expect(deps.findDocument).toHaveBeenCalledWith("user-1", "doc-1");
    expect(deps.deleteRagDocument).toHaveBeenCalledWith("user-1", "doc-1");
    expect(deps.resetUserRag).toHaveBeenCalledWith("user-1");
  });

  it("does not reset user RAG when other documents remain", async () => {
    const { deps } = createDeps({ remainingDocuments: 2 });
    const service = createDocumentLifecycleService(deps);

    const result = await service.deleteDocument("user-1", "doc-1");

    expect("notFound" in result).toBe(false);
    if ("notFound" in result) throw new Error("expected deletion result");
    expect(result.cleanup.rag).toBe("deleted");
    expect(deps.resetUserRag).not.toHaveBeenCalled();
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
  });

  it("deletes multiple documents through the single-document lifecycle", async () => {
    const { deps } = createDeps({ remainingDocuments: 0 });
    const service = createDocumentLifecycleService(deps);

    const result = await service.deleteDocuments("user-1", ["doc-1", "doc-2"]);

    expect(result.deleted).toEqual(["doc-1", "doc-2"]);
    expect(deps.findDocument).toHaveBeenCalledTimes(2);
    expect(deps.deleteDocumentRows).toHaveBeenCalledTimes(2);
  });
});
