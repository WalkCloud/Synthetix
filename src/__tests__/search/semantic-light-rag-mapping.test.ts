import { describe, expect, it } from "vitest";
import { mapRagChunkToSearchResult } from "@/lib/search/semantic";

describe("mapRagChunkToSearchResult", () => {
  it("uses query-centered excerpt and preserves diagnostics", () => {
    const result = mapRagChunkToSearchResult({
      chunk: {
        chunk_id: "doc-1/chunk_001",
        content: "凭据管理\n\n密码 Token SSH key。\n\n微服务治理平台提供日志分析能力。" + "制品管理。".repeat(60),
        title: "数据化运营",
        score: 0.72,
        rank: 3,
        vector_score: 0.72,
      },
      query: "微服务治理",
      mode: "mix",
      docName: "example.docx",
      docId: "doc-1",
      rerank: "missing",
    });

    expect(result.content).toContain("微服务治理平台");
    expect(result.rank).toBe(3);
    expect(result.source).toBe("lightrag");
    expect(result.debug?.vectorScore).toBe(0.72);
    expect(result.debug?.mode).toBe("mix");
  });
});
