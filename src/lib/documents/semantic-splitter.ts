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

interface SplitMergeResult {
  chunks: SplitChunk[];
  topics: { title: string; chunkIndices: number[] }[];
}

interface SemanticSplitResult {
  chunks: SplitChunk[];
  topics: { title: string; chunkIndices: number[] }[];
  inputTokens: number;
  outputTokens: number;
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
    return { chunks: structuralChunks, topics: [], inputTokens: 0, outputTokens: 0 };
  }

  const provider = createLLMProvider(modelConfig.provider);
  const BATCH_SIZE = 20;
  const CONCURRENCY = 3;

  let totalInput = 0;
  let totalOutput = 0;
  const allDecisions: MergeDecision[] = [];

  const batches: { offset: number; chunks: SplitChunk[] }[] = [];
  for (let b = 0; b < structuralChunks.length; b += BATCH_SIZE) {
    batches.push({ offset: b, chunks: structuralChunks.slice(b, b + BATCH_SIZE) });
  }

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const slice = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      slice.map(async ({ offset, chunks: batchChunks }) => {
        const titleList = batchChunks.map((c, j) =>
          `[${offset + j}] ${c.title}`
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

        const resp = await provider.chat({
          model: modelConfig.modelId,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          maxTokens: 1024,
        });

        totalInput += resp.inputTokens;
        totalOutput += resp.outputTokens;

        const text = resp.content.trim();
        const jsonStr = extractFirstJsonArray(text);
        if (!jsonStr) return [];
        const parsed = JSON.parse(jsonStr);
        return Array.isArray(parsed) ? (parsed as MergeDecision[]) : [];
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        allDecisions.push(...r.value);
      } else if (r.status === "rejected") {
        console.warn(`Semantic batch failed:`, r.reason);
      }
    }
  }

  // No merge decisions: keep structural chunks as-is
  if (allDecisions.length === 0) {
    const topics = structuralChunks.map((c) => ({
      title: c.headingPath || c.title,
      chunkIndices: [c.index],
    }));
    return { chunks: structuralChunks, topics, inputTokens: totalInput, outputTokens: totalOutput };
  }

  // Apply merge decisions
  const merged = applyMerges(structuralChunks, allDecisions);
  return { ...merged, inputTokens: totalInput, outputTokens: totalOutput };
}

function applyMerges(
  structuralChunks: SplitChunk[],
  decisions: MergeDecision[],
): SplitMergeResult {
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

function extractFirstJsonArray(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "]") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = text.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          start = -1;
        }
      }
    }
  }
  return null;
}
