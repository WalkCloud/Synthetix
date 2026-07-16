import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnPythonJson } = vi.hoisted(() => ({
  spawnPythonJson: vi.fn(),
}));
vi.mock("@/lib/python", () => ({ spawnPythonJson }));

import { manageRag, RagIndexBusyError } from "@/lib/rag/client";

const base = {
  userId: "user-1",
  embedDim: 1536,
  embedConfig: { apiBase: "", apiKey: "", model: "embed" },
  llmConfig: { apiBase: "", apiKey: "", model: "chat" },
};

describe("manageRag delete busy handling", () => {
  beforeEach(() => spawnPythonJson.mockReset());

  it("maps indexing lock result to a retriable error", async () => {
    spawnPythonJson.mockResolvedValue({
      status: "busy",
      code: "RAG_INDEX_BUSY",
      retryable: true,
      doc_id: "doc-1",
    });

    const promise = manageRag({ ...base, action: "delete-by-doc", docId: "doc-1" });
    await expect(promise).rejects.toBeInstanceOf(RagIndexBusyError);
    await expect(promise).rejects.toMatchObject({ code: "RAG_INDEX_BUSY", retryable: true });
  });

  it("returns an ordinary delete result unchanged", async () => {
    spawnPythonJson.mockResolvedValue({ status: "deleted", doc_id: "doc-1" });
    await expect(manageRag({ ...base, action: "delete-by-doc", docId: "doc-1" }))
      .resolves.toEqual({ status: "deleted", doc_id: "doc-1" });
  });
});
