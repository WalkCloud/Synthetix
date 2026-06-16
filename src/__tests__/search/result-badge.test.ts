import { describe, expect, it } from "vitest";
import { getSearchResultBadge } from "@/lib/search/result-badge";
import type { SearchResult } from "@/types/documents";

function result(score: number, source: SearchResult["source"] = "fused"): SearchResult {
  return {
    chunkId: "doc/chunk_001",
    documentId: "doc",
    documentName: "doc.docx",
    title: null,
    content: "微服务治理平台提供日志分析能力。",
    score,
    source,
    debug: { keywordRank: 1, vectorScore: score },
  };
}

describe("search result badges", () => {
  it("shows semantic match degree instead of a generic exact-match label", () => {
    const badge = getSearchResultBadge(result(0.72), "semantic", "zh-CN");

    expect(badge.text).toBe("72% 匹配");
  });

  it("shows keyword match degree instead of a generic keyword label", () => {
    const badge = getSearchResultBadge(result(1, "keyword"), "keyword", "zh-CN");

    expect(badge.text).toBe("100% 命中");
  });
});
