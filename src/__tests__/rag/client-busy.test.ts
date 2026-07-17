import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnPythonJson } = vi.hoisted(() => ({
  spawnPythonJson: vi.fn(),
}));
vi.mock("@/lib/python", () => ({ spawnPythonJson }));

import { manageRag, RagMutationBusyError, RagIndexBusyError } from "@/lib/rag/client";

const base = {
  userId: "user-1",
  embedDim: 1536,
  embedConfig: { apiBase: "", apiKey: "", model: "embed" },
  llmConfig: { apiBase: "", apiKey: "", model: "chat" },
};

describe("manageRag mutation busy handling", () => {
  beforeEach(() => spawnPythonJson.mockReset());

  it("maps busy result to RagMutationBusyError for any mutating action", async () => {
    spawnPythonJson.mockResolvedValue({
      status: "busy",
      code: "RAG_MUTATION_BUSY",
      retryable: true,
      user_id: "user-1",
    });

    const promise = manageRag({ ...base, action: "delete-by-doc", docId: "doc-1" });
    await expect(promise).rejects.toBeInstanceOf(RagMutationBusyError);
    await expect(promise).rejects.toMatchObject({ code: "RAG_MUTATION_BUSY", retryable: true });
  });

  it("RagIndexBusyError is a backward-compatible alias for RagMutationBusyError", () => {
    // Older code may still import RagIndexBusyError.
    expect(RagIndexBusyError).toBe(RagMutationBusyError);
  });

  it("returns an ordinary delete result unchanged", async () => {
    spawnPythonJson.mockResolvedValue({ status: "deleted", doc_id: "doc-1" });
    await expect(manageRag({ ...base, action: "delete-by-doc", docId: "doc-1" }))
      .resolves.toEqual({ status: "deleted", doc_id: "doc-1" });
  });
});
