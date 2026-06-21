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
  beforeEach(async () => {
    findMany.mockReset();
    manageRag.mockReset();
    // Fresh cache per test so order/timing never leaks across cases.
    const { clearGraphCache } = await import("@/lib/knowledge/graph-cache");
    clearGraphCache();
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
    expect(manageRag).toHaveBeenCalledWith(expect.objectContaining({
      action: "core-graph",
      minDegree: 1,
    }));
  });

  it("serves a repeated identical request from cache without re-invoking manageRag", async () => {
    const graph = { entity: "Center", graph: { nodes: [{ id: "n1" }], edges: [] }, total_entities: 1 };
    manageRag.mockResolvedValueOnce(graph);
    const { GET } = await import("@/app/api/v1/knowledge/graph/route");
    const url = "http://localhost/api/v1/knowledge/graph?mode=core&min_degree=1&depth=2&max_nodes=150";

    const first = await GET(new Request(url));
    const second = await GET(new Request(url));

    expect(await first.json()).toEqual({ success: true, data: graph });
    expect(await second.json()).toEqual({ success: true, data: graph });
    // Only the first request reaches Python; the second is served from cache.
    expect(manageRag).toHaveBeenCalledTimes(1);
  });
});

