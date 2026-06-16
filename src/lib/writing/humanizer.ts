import { getLLMClient } from "@/lib/llm/client";
import { recordTokenUsageSafely } from "@/lib/llm/usage";
import { buildHumanizerPrompts, type DocumentLanguage } from "@/lib/prompts";

/**
 * Anti-AI writing pattern detection and rewrite module.
 * Based on the Humanizer project (github.com/blader/humanizer) — 29 AI writing
 * patterns across 5 categories, with a two-pass self-audit rewrite process.
 */

const HUMANIZER_TEMPERATURE = 0.75;

export interface HumanizeResult {
  content: string;
  auditNotes: string;
  inputTokens: number;
  outputTokens: number;
}

export async function humanizeContent(
  content: string,
  sectionTitle: string,
  userId: string,
  docLocale: DocumentLanguage = "en",
): Promise<HumanizeResult> {
  const { provider, modelId, modelConfigId } = await getLLMClient("writing", userId);
  const { audit: auditPrompt, rewrite: rewritePrompt } = buildHumanizerPrompts(docLocale);

  // Pass 1: Audit — detect AI patterns
  const auditResponse = await provider.chat({
    model: modelId,
    messages: [
      { role: "system", content: auditPrompt },
      {
        role: "user",
        content: `Section: "${sectionTitle}"\n\n${content}`,
      },
    ],
    temperature: HUMANIZER_TEMPERATURE,
  });

  // Pass 2: Rewrite — eliminate detected patterns
  const rewriteResponse = await provider.chat({
    model: modelId,
    messages: [
      { role: "system", content: rewritePrompt },
      {
        role: "user",
        content: [
          `## Original Text (Section: "${sectionTitle}")`,
          "",
          content,
          "",
          "## AI Pattern Audit Results",
          "",
          auditResponse.content,
          "",
          "Rewrite the original text based on this audit. Preserve all facts, references, and technical accuracy.",
        ].join("\n"),
      },
    ],
    temperature: HUMANIZER_TEMPERATURE,
  });

  const totalInput = auditResponse.inputTokens + rewriteResponse.inputTokens;
  const totalOutput = auditResponse.outputTokens + rewriteResponse.outputTokens;

  await recordTokenUsageSafely({
    userId,
    modelConfigId,
    module: "writing",
    inputTokens: totalInput,
    outputTokens: totalOutput,
  });

  return {
    content: rewriteResponse.content,
    auditNotes: auditResponse.content,
    inputTokens: totalInput,
    outputTokens: totalOutput,
  };
}

