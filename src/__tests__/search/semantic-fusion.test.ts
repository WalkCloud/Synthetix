import { describe, expect, it } from "vitest";
import { rrfFuseForTest } from "@/lib/search/semantic";
import type { SearchResult } from "@/types/documents";

function result(chunkId: string, content: string, score: number, source: SearchResult["source"]): SearchResult {
  return {
    chunkId,
    documentId: chunkId.split("/")[0] || "doc",
    documentName: "doc.docx",
    title: null,
    content,
    score,
    source,
  };
}

describe("RRF fusion", () => {
  it("boosts chunks found by both semantic and keyword rankers", () => {
    const semantic = [
      result("doc/a", "凭据管理 Token SSH key", 0.75, "direct_embedding"),
      result("doc/b", "微服务治理平台提供日志分析能力", 0.7, "direct_embedding"),
    ];
    const keyword = [
      result("doc/b", "微服务治理平台提供日志分析能力", 1, "keyword"),
    ];

    const fused = rrfFuseForTest(semantic, keyword, [], 2, "微服务治理");
    expect(fused[0].chunkId).toBe("doc/b");
    expect(fused[0].debug?.keywordRank).toBe(1);
    expect(fused[0].debug?.fusionScore).toBeGreaterThan(0);
  });

  it("boosts exact phrase matches over broad unrelated prefixes", () => {
    const semantic = [
      result("doc/a", "凭据管理 Token SSH key。后文提到服务治理。", 0.75, "direct_embedding"),
      result("doc/b", "微服务治理场景下服务之间调用存在安全风险。", 0.7, "direct_embedding"),
    ];

    const fused = rrfFuseForTest(semantic, [], [], 2, "微服务治理");
    expect(fused[0].chunkId).toBe("doc/b");
  });

  it("does not expose keyword mark tags in semantic fused results", () => {
    const keyword = [
      result("doc/a", "ACP 平台具备 <mark>微</mark> <mark>服务</mark> <mark>治理</mark> 能力。", 1, "keyword"),
    ];

    const fused = rrfFuseForTest([], keyword, [], 1, "微服务治理");

    expect(fused[0].content).toBe("ACP 平台具备 微 服务 治理 能力。");
    expect(fused[0].content).not.toContain("<mark>");
  });

  it("sorts final semantic results by visible match degree", () => {
    const semantic = [
      result("doc/a", "微服务治理平台总体架构。", 0.62, "direct_embedding"),
      result("doc/b", "微服务治理能力说明。", 0.88, "direct_embedding"),
    ];
    const keyword = [
      result("doc/a", "微服务治理平台总体架构。", 1, "keyword"),
    ];

    const fused = rrfFuseForTest(semantic, keyword, [], 2, "微服务治理");

    expect(fused.map((r) => r.chunkId)).toEqual(["doc/b", "doc/a"]);
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });

  it("merges LightRAG results with direct-embedding by normalizing chunk IDs", () => {
    // LightRAG uses "{docId}/{chunkId}" format; direct-embedding uses raw DB id.
    // Same underlying chunk must merge, not appear twice.
    const direct = [
      result("b", "微服务治理能力说明。", 0.7, "direct_embedding"),
    ];
    const lightrag = [
      result("doc/b", "微服务治理能力说明。", 0.8, "lightrag"),
    ];

    const fused = rrfFuseForTest(direct, [], lightrag, 5, "微服务治理");

    // Should be 1 entry, not 2 — normalized "doc/b" → "b" matches direct "b"
    expect(fused).toHaveLength(1);
    expect(fused[0].source).toBe("fused");
  });
});
