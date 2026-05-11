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

interface MergeDecision {
  action: "merge" | "split" | "keep";
  indices: number[];
  topic?: string;
}

interface SemanticSplitResult {
  chunks: SplitChunk[];
  topics: { title: string; chunkIndices: number[] }[];
}

async function reviewChunkBatch(
  provider: ReturnType<typeof createLLMProvider>,
  modelId: string,
  batch: { index: number; title: string; headingPath: string; preview: string }[],
): Promise<MergeDecision[]> {
  const prompt = `You are analysing document chunks for semantic coherence. For each adjacent pair of chunks, decide:
- "keep": chunks are on different topics — keep them separate
- "merge": chunks continue the same topic — merge them

Chunks:
${batch.map((c) => `[${c.index}] headingPath: ${c.headingPath}\npreview: ${c.preview.slice(0, 400)}`).join("\n\n")}

Return a JSON array of merge decisions:
[{"action":"keep"|"merge","indices":[first,second],"topic":"short topic label"}]

Only group 2-5 adjacent chunks that share a clear topic. Return ONLY the JSON array.`;

  const resp = await provider.chat({
    model: modelId,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 2048,
  });

  try {
    const text = resp.content.trim();
    const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
    return JSON.parse(json) as MergeDecision[];
  } catch {
    return [];
  }
}

function extractPreview(content: string): string {
  return content.replace(/!\[.*?\]\(data:image\/[^)]+\)/g, "[image]").slice(0, 600);
}

export async function semanticSplit(
  structuralChunks: SplitChunk[],
  modelConfig: SemanticModelConfig,
): Promise<SemanticSplitResult> {
  if (structuralChunks.length <= 1) {
    return { chunks: structuralChunks, topics: [] };
  }

  const provider = createLLMProvider(modelConfig.provider);
  const BATCH_SIZE = 15;

  const allDecisions: MergeDecision[] = [];

  for (let b = 0; b < structuralChunks.length; b += BATCH_SIZE) {
    const batchIndices = Array.from(
      { length: Math.min(BATCH_SIZE, structuralChunks.length - b) },
      (_, i) => b + i,
    );
    const batch = batchIndices.map((i) => ({
      index: i,
      title: structuralChunks[i].title,
      headingPath: structuralChunks[i].headingPath,
      preview: extractPreview(structuralChunks[i].content),
    }));

    const decisions = await reviewChunkBatch(provider, modelConfig.modelId, batch);
    allDecisions.push(...decisions);
  }

  // Apply merge decisions
  const mergeGroups: number[][] = [];
  const processed = new Set<number>();

  for (const decision of allDecisions) {
    if (decision.action !== "merge") continue;
    if (decision.indices.length < 2) continue;

    const [a, b] = decision.indices;
    if (processed.has(a) || processed.has(b)) continue;

    let group = mergeGroups.find((g) => g.includes(a) || g.includes(b));
    if (!group) {
      group = [];
      mergeGroups.push(group);
    }

    if (!group.includes(a)) group.push(a);
    if (!group.includes(b)) group.push(b);
    processed.add(a);
    processed.add(b);
  }

  let outputIndex = 0;
  const resultChunks: SplitChunk[] = [];
  const topics: { title: string; chunkIndices: number[] }[] = [];

  for (let i = 0; i < structuralChunks.length; i++) {
    if (processed.has(i)) {
      const group = mergeGroups.find((g) => g.includes(i));
      if (!group || group[0] !== i) continue;

      const groupChunks = group.sort((a, b) => a - b).map((idx) => structuralChunks[idx]);
      const mergedContent = groupChunks.map((c) => c.content).join("\n\n");
      const mergedTitle = groupChunks[groupChunks.length - 1].headingPath
        || groupChunks[0].title;
      const mergedTokens = groupChunks.reduce((sum, c) => sum + c.tokenCount, 0);

      resultChunks.push({
        index: outputIndex++,
        title: mergedTitle,
        content: mergedContent,
        tokenCount: mergedTokens,
        headingPath: groupChunks.map((c) => c.headingPath).filter(Boolean).join(" > "),
      });

      const decision = allDecisions.find((d) => d.indices.includes(group[0]));
      topics.push({
        title: decision?.topic || mergedTitle,
        chunkIndices: [resultChunks.length - 1],
      });
    } else {
      resultChunks.push({
        ...structuralChunks[i],
        index: outputIndex++,
      });
      topics.push({
        title: structuralChunks[i].headingPath || structuralChunks[i].title,
        chunkIndices: [resultChunks.length - 1],
      });
    }
  }

  return { chunks: resultChunks, topics };
}
