import { splitByLinesInternal } from "@/lib/documents/pipeline";
import type { SplitChunk } from "@/lib/documents/splitter";

export function enforceEmbeddingSafeChunks(
  chunks: SplitChunk[],
  maxTokens: number,
): SplitChunk[] {
  const safeChunks: SplitChunk[] = [];

  for (const chunk of chunks) {
    if (chunk.tokenCount <= maxTokens) {
      safeChunks.push(chunk);
      continue;
    }

    const subChunks = splitByLinesInternal(chunk.content, maxTokens, chunk.title);
    if (subChunks.length <= 1) {
      safeChunks.push({
        ...chunk,
        tokenCount: Math.min(chunk.tokenCount, maxTokens),
      });
      continue;
    }

    for (let i = 0; i < subChunks.length; i++) {
      safeChunks.push({
        index: safeChunks.length,
        title: `${chunk.title} (part ${i + 1}/${subChunks.length})`,
        content: subChunks[i].content,
        tokenCount: subChunks[i].tokenCount,
        headingPath: chunk.headingPath,
      });
    }
  }

  return safeChunks;
}
