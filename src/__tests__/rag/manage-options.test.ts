import { describe, it, expect } from "vitest";
import type { RagManageOptions } from "@/lib/rag/client";

describe("RagManageOptions discriminated union", () => {
  function extractActionSpecificFields(options: RagManageOptions): Record<string, unknown> {
    switch (options.action) {
      case "entities":
        return { keyword: options.keyword, limit: options.limit };
      case "entity-detail":
        return { entityName: options.entityName, depth: options.depth };
      case "graph":
      case "core-graph":
      case "overview-graph":
        return { entityName: options.entityName, minDegree: options.minDegree };
      case "create-entity":
        return { entityName: options.entityName, entityType: options.entityType, description: options.description };
      case "delete-entity":
        return { entityName: options.entityName };
      case "merge-entities":
        return { sources: options.sources, target: options.target };
      case "delete-by-doc":
        return { docId: options.docId };
    }
  }

  const baseConfig = {
    userId: "user-1",
    embedDim: 1536,
    embedConfig: { apiBase: "https://api.openai.com", apiKey: "sk-test", model: "text-embedding-3-small" },
    llmConfig: { apiBase: "https://api.openai.com", apiKey: "sk-test", model: "gpt-4" },
  };

  it("entities action accepts keyword and limit", () => {
    const opts: RagManageOptions = { action: "entities", ...baseConfig, keyword: "test", limit: 10 };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ keyword: "test", limit: 10 });
  });

  it("entity-detail action requires entityName", () => {
    const opts: RagManageOptions = { action: "entity-detail", ...baseConfig, entityName: "React", depth: 2, maxNodes: 50 };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ entityName: "React", depth: 2 });
  });

  it("graph action accepts optional entityName and minDegree", () => {
    const opts: RagManageOptions = { action: "graph", ...baseConfig, minDegree: 3 };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ entityName: undefined, minDegree: 3 });
  });

  it("core-graph action is valid", () => {
    const opts: RagManageOptions = { action: "core-graph", ...baseConfig, entityName: "API" };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ entityName: "API", minDegree: undefined });
  });

  it("overview-graph action is valid", () => {
    const opts: RagManageOptions = { action: "overview-graph", ...baseConfig, maxNodes: 80, minDegree: 2 };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ entityName: undefined, minDegree: 2 });
  });

  it("create-entity action requires all fields", () => {
    const opts: RagManageOptions = { action: "create-entity", ...baseConfig, entityName: "X", entityType: "Technology", description: "A thing" };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ entityName: "X", entityType: "Technology", description: "A thing" });
  });

  it("delete-entity action requires entityName", () => {
    const opts: RagManageOptions = { action: "delete-entity", ...baseConfig, entityName: "Old" };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ entityName: "Old" });
  });

  it("merge-entities action requires sources and target", () => {
    const opts: RagManageOptions = { action: "merge-entities", ...baseConfig, sources: "A,B", target: "C" };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ sources: "A,B", target: "C" });
  });

  it("delete-by-doc action requires docId", () => {
    const opts: RagManageOptions = { action: "delete-by-doc", ...baseConfig, docId: "doc-123" };
    const result = extractActionSpecificFields(opts);
    expect(result).toEqual({ docId: "doc-123" });
  });
});
