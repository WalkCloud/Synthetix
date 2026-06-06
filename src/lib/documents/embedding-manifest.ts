export interface EmbeddingManifestEntry {
  chunkId: string;
  chunkIndex: number;
  embeddingOffset: number;
  embeddingDim: number;
}

export interface EmbeddingManifest {
  documentId: string;
  embedModel: string;
  embeddingDim: number;
  entries: EmbeddingManifestEntry[];
}

interface ManifestChunk {
  id: string;
  index: number;
}

export function buildEmbeddingManifest({
  documentId,
  embedModel,
  embeddingDim,
  chunks,
}: {
  documentId: string;
  embedModel: string;
  embeddingDim: number;
  chunks: ManifestChunk[];
}): EmbeddingManifest {
  const orderedChunks = [...chunks].sort((a, b) => a.index - b.index);

  return {
    documentId,
    embedModel,
    embeddingDim,
    entries: orderedChunks.map((chunk, embeddingOffset) => ({
      chunkId: chunk.id,
      chunkIndex: chunk.index,
      embeddingOffset,
      embeddingDim,
    })),
  };
}
