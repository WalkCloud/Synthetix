import { describe, expect, it } from "vitest";

import { titleSimilarity, decideMerge } from "@/lib/wiki/merger";

describe("titleSimilarity", () => {
  it("returns 1 for identical titles", () => {
    expect(titleSimilarity("Microservice Architecture", "Microservice Architecture")).toBe(1);
  });

  it("returns high similarity for word overlap", () => {
    const score = titleSimilarity("Microservice Communication", "Microservice Architecture");
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for completely disjoint titles", () => {
    expect(titleSimilarity("Quantum Physics", "Baking Bread")).toBe(0);
  });

  it("is case-insensitive for latin", () => {
    expect(titleSimilarity("REST API", "rest api")).toBe(1);
  });

  it("handles CJK per-character tokenization", () => {
    // 微服务架构 vs 微服务通信 — shares 微,服,务 (3 of 6 unique chars)
    const score = titleSimilarity("微服务架构", "微服务通信");
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when one title is empty", () => {
    expect(titleSimilarity("", "Something")).toBe(0);
    expect(titleSimilarity("Something", "")).toBe(0);
  });
});

describe("decideMerge", () => {
  const existing = [
    { title: "Microservice Architecture", slug: "microservice-architecture" },
    { title: "API Gateway", slug: "api-gateway" },
    { title: "微服务通信", slug: "微服务通信" },
  ];

  it("decides 'create' when no existing title is similar", () => {
    const result = decideMerge("Completely New Topic", existing);
    expect(result.action).toBe("create");
  });

  it("decides 'update' when an existing title matches (identical)", () => {
    const result = decideMerge("Microservice Architecture", existing);
    expect(result.action).toBe("update");
    if (result.action === "update") {
      expect(result.existingSlug).toBe("microservice-architecture");
    }
  });

  it("decides 'update' for a near-duplicate above the threshold", () => {
    // Exact duplicate with minor punctuation difference still matches strongly
    const result = decideMerge("Microservice Architecture!", existing);
    expect(result.action).toBe("update");
  });

  it("decides 'create' for a title with low overlap", () => {
    const result = decideMerge("Database Sharding Strategy", existing);
    expect(result.action).toBe("create");
  });

  it("handles CJK title matching", () => {
    const result = decideMerge("微服务通信模式", existing);
    expect(result.action).toBe("update");
    if (result.action === "update") {
      expect(result.existingSlug).toBe("微服务通信");
    }
  });

  it("decides 'create' when existing list is empty", () => {
    const result = decideMerge("Any New Topic", []);
    expect(result.action).toBe("create");
  });
});
