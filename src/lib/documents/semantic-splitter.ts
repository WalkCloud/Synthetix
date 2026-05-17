import { createLLMProvider } from "@/lib/llm/factory";
import type { SplitChunk } from "./splitter";

interface SemanticModelConfig {
  modelId: string;
  provider: {
    id: string;
    name: string;
    providerType: string;
    apiBaseUrl: string;
    apiKey: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

interface SemanticSplitResult {
  chunks: SplitChunk[];
  topics: { title: string; chunkIndices: number[] }[];
}

interface MergeDecision {
  action: "merge" | "keep";
  indices: number[];
  topic?: string;
}

export async function semanticSplit(
  structuralChunks: SplitChunk[],
  modelConfig: SemanticModelConfig,
): Promise<SemanticSplitResult> {
  if (structuralChunks.length <= 1) {
    return { chunks: structuralChunks, topics: [] };
  }

  const provider = createLLMProvider(modelConfig.provider);
  const BATCH_SIZE = 10;

  const allDecisions: MergeDecision[] = [];

  // Send section TITLES to LLM (not content) — lightweight merge decisions
  for (let b = 0; b < structuralChunks.length; b += BATCH_SIZE) {
    const batchChunks = structuralChunks.slice(b, b + BATCH_SIZE);
    const titleList = batchChunks.map((c, i) =>
      `[${b + i}] ${c.title}`
    ).join("\n");

    const prompt = `These are consecutive section titles from a document. For each ADJACENT pair, decide if they belong to the same topic and should be merged.

${titleList}

Return ONLY a JSON array of decisions for adjacent pairs:
[{"action":"merge"|"keep","indices":[a,b],"topic":"short topic label"}]

Rules:
- Merge only if the two sections clearly discuss the same topic/domain (e.g. both about "cluster management", both about "security configuration").
- Keep separate if they cover different aspects or independent topics.
- The topic label should be 3-8 words, in the same language as the titles.
- Only return decisions for pairs that should be merged.`;

    try {
      const resp = await provider.chat({
        model: modelConfig.modelId,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        maxTokens: 1024,
      });

      const text = resp.content.trim();
      const startIdx = text.indexOf("[");
      const endIdx = text.lastIndexOf("]");
      if (startIdx !== -1 && endIdx !== -1) {
        const parsed = JSON.parse(text.slice(startIdx, endIdx + 1));
        if (Array.isArray(parsed)) {
          allDecisions.push(...(parsed as MergeDecision[]));
        }
      }
    } catch (err) {
      console.warn(`Semantic batch ${b} failed:`, err);
    }
  }

  // No merge decisions: keep structural chunks as-is
  if (allDecisions.length === 0) {
    const topics = structuralChunks.map((c) => ({
      title: c.headingPath || c.title,
      chunkIndices: [c.index],
    }));
    return { chunks: structuralChunks, topics };
  }

  // Apply merge decisions
  return applyMerges(structuralChunks, allDecisions);
}

function applyMerges(
  structuralChunks: SplitChunk[],
  decisions: MergeDecision[],
): SemanticSplitResult {
  const merged = new Set<number>();
  const groups: { title: string; indices: number[] }[] = [];

  for (const d of decisions) {
    if (d.action !== "merge" || d.indices.length < 2) continue;
    const [a, b] = d.indices;

    // Find existing group or create new one
    let group = groups.find((g) => g.indices.includes(a) || g.indices.includes(b));
    if (!group) {
      group = { title: d.topic || `Group ${groups.length + 1}`, indices: [] };
      groups.push(group);
    }
    if (!group.indices.includes(a)) group.indices.push(a);
    if (!group.indices.includes(b)) group.indices.push(b);
    merged.add(a);
    merged.add(b);
  }

  // Sort each group's indices
  for (const g of groups) {
    g.indices.sort((a, b) => a - b);
  }

  // Build result chunks
  const resultChunks: SplitChunk[] = [];
  const topics: { title: string; chunkIndices: number[] }[] = [];

  for (let i = 0; i < structuralChunks.length; i++) {
    if (merged.has(i)) {
      const group = groups.find((g) => g.indices.includes(i));
      if (!group || group.indices[0] !== i) continue;

      const groupChunks = group.indices.map((idx) => structuralChunks[idx]);
      const mergedContent = groupChunks.map((c) => c.content).join("\n\n");
      const mergedTokens = groupChunks.reduce((sum, c) => sum + c.tokenCount, 0);
      const mergedTitle = group.title;

      const idx = resultChunks.length;
      resultChunks.push({
        index: idx,
        title: mergedTitle,
        content: mergedContent,
        tokenCount: mergedTokens,
        headingPath: groupChunks.map((c) => c.headingPath).filter(Boolean).join(" > "),
      });
      topics.push({ title: mergedTitle, chunkIndices: [idx] });
    } else {
      const idx = resultChunks.length;
      resultChunks.push({ ...structuralChunks[i], index: idx });
      topics.push({
        title: structuralChunks[i].headingPath || structuralChunks[i].title,
        chunkIndices: [idx],
      });
    }
  }

  return { chunks: resultChunks, topics };
}

function extractPreview(content: string, maxLen = 600): string {
  return content
    .replace(/!\[.*?\]\(data:image\/[^)]+\)/g, "[image]")
    .slice(0, maxLen);
}
