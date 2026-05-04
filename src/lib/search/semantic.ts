import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import { cosineSimilarity, bufferToFloat32 } from "@/lib/documents/embedder";
import type { SearchResult } from "@/types/documents";

export async function semanticSearch(
  query: string,
  userId: string,
  limit = 20
): Promise<SearchResult[]> {
  const embedModel = await db.modelConfig.findFirst({
    where: { isDefaultFor: "embedding" },
    include: { provider: true },
  });

  if (!embedModel) {
    throw new Error("No embedding model configured. Please add an embedding model in Model Management.");
  }

  const provider = createLLMProvider(embedModel.provider);
  const [queryEmbedding] = await provider.embed([query]);

  const chunks = await db.documentChunk.findMany({
    where: {
      document: { userId },
      embedding: { not: null },
    },
    include: { document: true },
  });

  const results: SearchResult[] = [];
  const queryVec = new Float32Array(queryEmbedding);

  for (const chunk of chunks) {
    if (!chunk.embedding) continue;
    const chunkBytes = chunk.embedding as unknown as Uint8Array;
    const chunkVec = bufferToFloat32(chunkBytes);
    const score = cosineSimilarity(queryVec, chunkVec);

    results.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.document.originalName,
      title: chunk.title,
      content: chunk.content.slice(0, 500),
      score,
    });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
