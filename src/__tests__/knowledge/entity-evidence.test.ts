import { describe, expect, it } from "vitest";
import {
  docIdFromChunkId,
  resolveEntityChunkIds,
  EntityNotInGraphError,
} from "@/lib/knowledge/entity-evidence";

describe("docIdFromChunkId", () => {
  it("extracts the docId from a standard chunk id", () => {
    expect(docIdFromChunkId("abc-123/chunk_000-chunk-000")).toBe("abc-123");
  });

  it("extracts a UUID-shaped docId", () => {
    const uuid = "8a4a7371-959b-4157-9721-726b97a448d9";
    expect(docIdFromChunkId(`${uuid}/chunk_010-chunk-002`)).toBe(uuid);
  });

  it("returns empty string when no slash present", () => {
    expect(docIdFromChunkId("malformed")).toBe("");
  });

  it("returns empty string for a leading slash", () => {
    expect(docIdFromChunkId("/chunk_000")).toBe("");
  });
});

describe("resolveEntityChunkIds", () => {
  const store = {
    "精益创业": { chunk_ids: ["doc1/chunk_000-chunk-000", "doc1/chunk_001-chunk-000"] },
    "客户开发": { chunk_ids: ["doc1/chunk_002-chunk-000"] },
    "Kubernetes (k8s)": { chunk_ids: ["doc2/chunk_000-chunk-000"] },
  };

  it("returns exact-match chunk_ids first", () => {
    expect(resolveEntityChunkIds(store, "精益创业")).toEqual([
      "doc1/chunk_000-chunk-000",
      "doc1/chunk_001-chunk-000",
    ]);
  });

  it("returns empty for an entity not in the store", () => {
    expect(resolveEntityChunkIds(store, "不存在")).toEqual([]);
  });

  it("matches case-insensitively when no exact match", () => {
    // The store key is "Kubernetes (k8s)"; query lowercase should still match.
    expect(resolveEntityChunkIds(store, "kubernetes (k8s)")).toEqual([
      "doc2/chunk_000-chunk-000",
    ]);
  });

  it("matches via substring for aliased entities", () => {
    // Query "k8s" should find "Kubernetes (k8s)" via substring.
    expect(resolveEntityChunkIds(store, "k8s")).toEqual(["doc2/chunk_000-chunk-000"]);
  });

  it("respects the maxChunks limit", () => {
    const big = {
      e: { chunk_ids: ["a/0", "a/1", "a/2", "a/3", "a/4", "a/5", "a/6", "a/7", "a/8", "a/9"] },
    };
    expect(resolveEntityChunkIds(big, "e", 3)).toHaveLength(3);
    expect(resolveEntityChunkIds(big, "e", 3)[0]).toBe("a/0");
  });

  it("deduplicates chunk_ids across multiple fuzzy matches", () => {
    const overlapping = {
      "Entity A": { chunk_ids: ["d/0", "d/1"] },
      "Entity B": { chunk_ids: ["d/1", "d/2"] },
    };
    // Both match the substring "Entity" → union should dedupe d/1.
    const result = resolveEntityChunkIds(overlapping, "Entity", 8);
    expect(result).toEqual(["d/0", "d/1", "d/2"]);
  });

  it("handles empty/whitespace entity gracefully", () => {
    expect(resolveEntityChunkIds(store, "")).toEqual([]);
    expect(resolveEntityChunkIds(store, "   ")).toEqual([]);
  });

  it("handles empty store", () => {
    expect(resolveEntityChunkIds({}, "anything")).toEqual([]);
  });
});

describe("EntityNotInGraphError", () => {
  it("is an Error subclass with the right name", () => {
    const err = new EntityNotInGraphError("not here");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("EntityNotInGraphError");
    expect(err.message).toBe("not here");
  });
});
