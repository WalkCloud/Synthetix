import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

import { db } from "@/lib/db";
import { GET } from "@/app/api/v1/library/documents/[id]/route";

const USER_ID = "test-document-detail-round-user";
const DOC_ID = "test-document-detail-round-doc";

beforeEach(async () => {
  mockUserId = USER_ID;
  await db.user.upsert({
    where: { id: USER_ID },
    create: { id: USER_ID, username: USER_ID, passwordHash: "test-hash" },
    update: {},
  });
  await db.document.upsert({
    where: { id: DOC_ID },
    create: {
      id: DOC_ID,
      userId: USER_ID,
      originalName: "round.md",
      originalFormat: "md",
      originalSize: 10,
      originalPath: "/tmp/round.md",
      status: "ready",
    },
    update: { status: "ready" },
  });
  await db.asyncTask.deleteMany({ where: { userId: USER_ID } });
});

afterEach(async () => {
  await db.asyncTask.deleteMany({ where: { userId: USER_ID } });
  await db.document.deleteMany({ where: { id: DOC_ID } });
  await db.user.deleteMany({ where: { id: USER_ID } });
});

describe("GET /api/v1/library/documents/[id] task round", () => {
  it("builds pipeline rows only from the latest convert operation", async () => {
    await db.asyncTask.createMany({ data: [
      {
        id: "old-convert",
        userId: USER_ID,
        documentId: DOC_ID,
        operationId: "old-operation",
        type: "document_convert",
        status: "completed",
        progress: 100,
        inputData: JSON.stringify({ options: { indexMode: "graph", wikiEnabled: false, indexTarget: "full" } }),
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:05.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "old-graph",
        userId: USER_ID,
        documentId: DOC_ID,
        operationId: "old-operation",
        parentTaskId: "old-convert",
        type: "rag_index",
        status: "running",
        progress: 55,
        attempt: 0,
        startedAt: new Date("2026-01-01T00:00:06.000Z"),
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
      {
        id: "latest-convert",
        userId: USER_ID,
        documentId: DOC_ID,
        operationId: "latest-operation",
        type: "document_convert",
        status: "completed",
        progress: 100,
        inputData: JSON.stringify({ options: { indexMode: "basic", wikiEnabled: false, indexTarget: "full" } }),
        startedAt: new Date("2026-01-02T00:00:00.000Z"),
        finishedAt: new Date("2026-01-02T00:00:05.000Z"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        id: "latest-embed",
        userId: USER_ID,
        documentId: DOC_ID,
        operationId: "latest-operation",
        parentTaskId: "latest-convert",
        type: "rag_embed_index",
        status: "completed",
        progress: 100,
        startedAt: new Date("2026-01-02T00:00:06.000Z"),
        finishedAt: new Date("2026-01-02T00:00:20.000Z"),
        createdAt: new Date("2026-01-02T00:00:06.000Z"),
      },
    ] });

    const response = await GET(new Request("http://test/api/v1/library/documents/x"), {
      params: Promise.resolve({ id: DOC_ID }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.processingDurationMs).toBe(20_000);
    expect(json.data.pipeline.graphMode).toBe(false);
    expect(json.data.pipeline.branches).toEqual([]);
    expect(json.data.pipeline.stages.at(-1)?.status).toBe("done");
  });
});
