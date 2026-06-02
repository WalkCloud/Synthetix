import { db } from "@/lib/db";
import { resolveLLMClient } from "@/lib/llm/client";
import { recordTokenUsage } from "@/lib/llm/usage";
import { estimateTokens } from "@/lib/documents/splitter";
import type { ProcessingContext } from "@/lib/documents/pipeline";

const TAG_PROMPT = `You are a document classification assistant. Analyze the following document content and extract 3-5 relevant topic tags.

Rules:
- Tags must be concise English words or short phrases (1-3 words)
- Tags should represent the document's subject matter, domain, or topic
- Prefer specific tags over generic ones (e.g. "REST API" over "API", "microservices" over "architecture")
- Return ONLY a JSON array of lowercase strings, no explanation
- Example: ["rest-api", "microservices", "database", "authentication"]`;

const MAX_INPUT_TOKENS = 2000;
const TAG_MAX_TOKENS = 200;

function truncateToTokens(text: string, maxTokens: number): string {
  const lines = text.split("\n");
  let result = "";
  let tokenCount = 0;
  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (tokenCount + lineTokens > maxTokens) break;
    result += line + "\n";
    tokenCount += lineTokens;
  }
  return result.trim();
}

function parseTags(raw: string): string[] {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t.length > 0 && t.length <= 50)
        .slice(0, 7);
    }
    return [];
  } catch {
    const match = raw.match(/\[([^\]]+)\]/);
    if (match) {
      return match[1]
        .split(",")
        .map((t) => t.replace(/["']/g, "").toLowerCase().trim())
        .filter((t) => t.length > 0 && t.length <= 50)
        .slice(0, 7);
    }
    return [];
  }
}

export async function autoTagDocument(
  ctx: ProcessingContext,
  markdown: string,
): Promise<string[]> {
  const client = await resolveLLMClient("writing", ctx.doc.userId);
  if (!client) return [];

  const truncated = truncateToTokens(markdown, MAX_INPUT_TOKENS);
  if (!truncated) return [];

  try {
    const response = await client.provider.chat({
      model: client.modelId,
      messages: [
        { role: "system", content: TAG_PROMPT },
        { role: "user", content: `Document: ${ctx.doc.originalName}\n\n${truncated}` },
      ],
      temperature: 0.3,
      maxTokens: TAG_MAX_TOKENS,
    });

    const tags = parseTags(response.content);
    if (tags.length === 0) return [];

    for (const tagName of tags) {
      const tag = await db.tag.upsert({
        where: { name: tagName },
        update: {},
        create: { name: tagName },
      });
      await db.documentTag.upsert({
        where: {
          documentId_tagId: { documentId: ctx.docId, tagId: tag.id },
        },
        update: {},
        create: { documentId: ctx.docId, tagId: tag.id },
      });
    }

    await recordTokenUsage({
      userId: ctx.doc.userId,
      modelConfigId: client.modelConfigId,
      module: "auto-tag",
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      referenceId: ctx.docId,
    }).catch(() => {});

    return tags;
  } catch (err) {
    console.warn("Auto-tag failed (non-blocking):", err);
    return [];
  }
}
