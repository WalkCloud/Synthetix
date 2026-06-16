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
      result("doc/a", "凭据管理 Token SSH key", 0.75, "lightrag"),
      result("doc/b", "微服务治理平台提供日志分析能力", 0.7, "lightrag"),
    ];
    const keyword = [
      result("doc/b", "微服务治理平台提供日志分析能力", 1, "keyword"),
    ];

    const fused = rrfFuseForTest(semantic, keyword, 2, "微服务治理");
    expect(fused[0].chunkId).toBe("doc/b");
    expect(fused[0].debug?.keywordRank).toBe(1);
    expect(fused[0].debug?.fusionScore).toBeGreaterThan(0);
  });

  it("boosts exact phrase matches over broad unrelated prefixes", () => {
    const semantic = [
      result("doc/a", "凭据管理 Token SSH key。后文提到服务治理。", 0.75, "lightrag"),
      result("doc/b", "微服务治理场景下服务之间调用存在安全风险。", 0.7, "lightrag"),
    ];

    const fused = rrfFuseForTest(semantic, [], 2, "微服务治理");
    expect(fused[0].chunkId).toBe("doc/b");
  });

  it("does not expose keyword mark tags in semantic fused results", () => {
    const keyword = [
      result("doc/a", "ACP 平台具备 <mark>微</mark> <mark>服务</mark> <mark>治理</mark> 能力。", 1, "keyword"),
    ];

    const fused = rrfFuseForTest([], keyword, 1, "微服务治理");

    expect(fused[0].content).toBe("ACP 平台具备 微 服务 治理 能力。");
    expect(fused[0].content).not.toContain("<mark>");
  });

  it("sorts final semantic results by visible match degree", () => {
    const semantic = [
      result("doc/a", "微服务治理平台总体架构。", 0.62, "lightrag"),
      result("doc/b", "微服务治理能力说明。", 0.88, "lightrag"),
    ];
    const keyword = [
      result("doc/a", "微服务治理平台总体架构。", 1, "keyword"),
    ];

    const fused = rrfFuseForTest(semantic, keyword, 2, "微服务治理");

    expect(fused.map((r) => r.chunkId)).toEqual(["doc/b", "doc/a"]);
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });
});
