import { describe, expect, it, vi, beforeEach } from "vitest";

const findMany = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(async () => ({ id: "user-1", username: "kevin", role: "admin" })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    asyncTask: { findMany },
  },
}));

describe("GET /api/v1/tasks", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("includes result data for rag_index tasks", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "task-1",
        type: "rag_index",
        status: "completed",
        progress: 100,
        inputData: JSON.stringify({ docId: "doc-1" }),
        resultData: JSON.stringify({ ok: true, rag: { status: "indexed", chunks: 12, graph_entities: 24 } }),
        errorMessage: null,
        createdAt: new Date("2026-06-08T00:00:00.000Z"),
        updatedAt: new Date("2026-06-08T00:01:00.000Z"),
      },
    ]);

    const { GET } = await import("@/app/api/v1/tasks/route");
    const response = await GET(new Request("http://localhost/api/v1/tasks?type=rag_index&limit=5"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data[0].result).toEqual({ ok: true, rag: { status: "indexed", chunks: 12, graph_entities: 24 } });
  });
});
