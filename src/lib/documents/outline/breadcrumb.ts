import type { SplitChunk } from "@/lib/documents/splitter";

export function injectBreadcrumbs(chunks: SplitChunk[]): SplitChunk[] {
  return chunks.map((chunk) => {
    if (!chunk.headingPath) return chunk;
    const prefix = `[${chunk.headingPath}]\n`;
    return {
      ...chunk,
      content: prefix + chunk.content,
      tokenCount: chunk.tokenCount + Math.ceil(prefix.length / 2),
    };
  });
}
