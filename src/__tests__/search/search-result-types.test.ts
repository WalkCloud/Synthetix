import { describe, expect, it } from "vitest";
import type { SearchResult } from "@/types/documents";

describe("SearchResult metadata", () => {
  it("allows calibrated search metadata without breaking legacy score", () => {
    const result: SearchResult = {
      chunkId: "doc-1/chunk_001",
      documentId: "doc-1",
      documentName: "example.docx",
      title: "微服务治理",
      content: "微服务治理平台提供日志分析能力。",
      score: 0.82,
      rank: 1,
      source: "fused",
      relevanceLabel: "high",
      matchedTerms: ["微服务治理"],
      debug: {
        semanticRank: 2,
        keywordRank: 1,
        vectorScore: 0.72,
        keywordScore: 1,
        fusionScore: 0.091,
        rerank: "missing",
      },
    };

    expect(result.debug?.rerank).toBe("missing");
    expect(result.matchedTerms).toEqual(["微服务治理"]);
  });
});
