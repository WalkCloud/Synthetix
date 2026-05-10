import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import type { ChatMessage } from "@/lib/llm/types";

const SUMMARY_MAX_TOKENS = 300;
const SUMMARY_TEMPERATURE = 0.3;

function buildSummaryMessages(
  sectionContent: string,
  sectionTitle: string
): ChatMessage[] {
  const systemMessage: ChatMessage = {
    role: "system",
    content: [
      "You are a precise summarizer. Your task is to produce a compressed summary of a document section.",
      "",
      "Requirements:",
      "- Maximum 150 words.",
      "- Capture the key arguments, findings, or narrative points.",
      "- Preserve factual accuracy. Do not add information not present in the source.",
      "- Write in third person, present tense.",
      "- Output plain text without markdown formatting.",
    ].join("\n"),
  };

  const userMessage: ChatMessage = {
    role: "user",
    content: `Summarize the following section titled "${sectionTitle}":\n\n${sectionContent}`,
  };

  return [systemMessage, userMessage];
}

async function resolveDefaultModel() {
  const writingModel = await resolveModel("writing");

  if (writingModel?.provider) {
    return {
      provider: createLLMProvider({
        apiBaseUrl: writingModel.provider.apiBaseUrl,
        apiKey: writingModel.provider.apiKey,
      }),
      modelId: writingModel.modelId,
    };
  }

  throw new Error(
    "No model available for summarization. Configure a writing or chat model in settings."
  );
}

export async function generateSummary(
  sectionContent: string,
  sectionTitle: string
): Promise<string> {
  if (!sectionContent.trim()) {
    throw new Error("Cannot generate summary: section content is empty.");
  }

  if (!sectionTitle.trim()) {
    throw new Error("Cannot generate summary: section title is empty.");
  }

  const { provider, modelId } = await resolveDefaultModel();

  const messages = buildSummaryMessages(sectionContent, sectionTitle);

  try {
    const response = await provider.chat({
      model: modelId,
      messages,
      temperature: SUMMARY_TEMPERATURE,
      maxTokens: SUMMARY_MAX_TOKENS,
    });

    const summary = response.content.trim();

    if (!summary) {
      throw new Error("Model returned empty summary.");
    }

    return summary;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Summary generation failed: ${message}`);
  }
}
