import { describe, expect, it } from "vitest";
import { splitSectionReferences } from "@/lib/writing/reference-view";

describe("splitSectionReferences", () => {
  it("maps persisted references to RagReferenceView objects", () => {
    const result = splitSectionReferences([
      {
        documentName: "Architecture.pdf",
        relevanceScore: 0.92,
        sourceAnchor: "Product Architecture",
        documentId: "doc-1",
        chunkId: "chunk-1",
        content: "Graph reference content",
        images: null,
        sourceType: "rag_graph",
      },
      {
        documentName: "Specs.md",
        relevanceScore: 0.64,
        sourceAnchor: "Chunk 2",
        documentId: "doc-2",
        chunkId: "chunk-2",
        content: "Chunk reference content",
        images: null,
        sourceType: "rag_chunk",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      sourceType: "rag_graph",
      documentName: "Architecture.pdf",
      title: "Product Architecture",
    });
    expect(result[1]).toMatchObject({
      sourceType: "rag_chunk",
      documentName: "Specs.md",
      title: "Chunk 2",
    });
  });
});
