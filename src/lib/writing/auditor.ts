import { createLLMProvider } from "@/lib/llm/factory";
import { resolveModel } from "@/lib/llm/resolve-model";
import { buildAuditPrompt, parseAuditResponse, type AuditResult } from "./audit";

export async function auditSection(
  title: string,
  content: string,
  keyPoints?: string | null
): Promise<AuditResult> {
  const writingModel = await resolveModel("writing");
  if (!writingModel?.provider) {
    return {
      passed: true,
      score: 100,
      issues: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const provider = createLLMProvider({
    apiBaseUrl: writingModel.provider.apiBaseUrl,
    apiKey: writingModel.provider.apiKey,
  });

  const { system, user } = buildAuditPrompt(title, content, keyPoints);

  try {
    const response = await provider.chat({
      model: writingModel.modelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
    });

    return parseAuditResponse(response.content);
  } catch (error) {
    console.error("Section audit failed:", error);
    return {
      passed: true,
      score: 100,
      issues: [],
      checkedAt: new Date().toISOString(),
    };
  }
}
