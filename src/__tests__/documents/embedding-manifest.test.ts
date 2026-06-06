import { describe, expect, it } from "vitest";
import { buildEmbeddingManifest } from "@/lib/documents/embedding-manifest";

describe("buildEmbeddingManifest", () => {
  it("sorts entries by chunk index and assigns stable offsets", () => {
    const manifest = buildEmbeddingManifest({
      documentId: "doc-1",
      embedModel: "embed-model",
      embeddingDim: 3,
      chunks: [
        { id: "chunk-b", index: 2 },
        { id: "chunk-a", index: 1 },
      ],
    });

    expect(manifest.entries).toEqual([
      { chunkId: "chunk-a", chunkIndex: 1, embeddingOffset: 0, embeddingDim: 3 },
      { chunkId: "chunk-b", chunkIndex: 2, embeddingOffset: 1, embeddingDim: 3 },
    ]);
  });
});
