import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const manageRag = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(async () => ({ id: "user-1", username: "kevin", role: "admin" })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    document: { findMany },
  },
}));

vi.mock("@/lib/rag/context", () => ({
  createRagContext: vi.fn(async () => ({
    embedConfig: { apiBase: "https://embed.example", apiKey: "key", model: "embed" },
    llmConfig: { apiBase: "https://llm.example", apiKey: "key", model: "llm" },
    rerankConfig: undefined,
    embedDim: 1536,
  })),
}));

vi.mock("@/lib/rag/client", () => ({ manageRag }));

describe("GET /api/v1/knowledge/graph", () => {
  beforeEach(() => {
    findMany.mockReset();
    manageRag.mockReset();
  });

  it("does not hide LightRAG results when the user has no documents", async () => {
    findMany.mockResolvedValueOnce([]);
    manageRag.mockResolvedValueOnce({ entity: "", graph: { nodes: [], edges: [] }, total_entities: 0 });
    const { GET } = await import("@/app/api/v1/knowledge/graph/route");

    const response = await GET(new Request("http://localhost/api/v1/knowledge/graph"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { entity: "", graph: { nodes: [], edges: [] }, total_entities: 0 },
    });
    expect(manageRag).toHaveBeenCalledOnce();
  });
});
