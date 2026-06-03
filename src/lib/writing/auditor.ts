import { resolveLLMClient } from "@/lib/llm/client";
import { recordTokenUsage } from "@/lib/llm/usage";
import { buildAuditPrompt, parseAuditResponse, type AuditResult } from "./audit";
import type { DocumentLanguage } from "@/lib/prompts";

export async function auditSection(
  title: string,
  content: string,
  keyPoints?: string | null,
  userId?: string,
  referenceId?: string,
  docLocale: DocumentLanguage = "en",
): Promise<AuditResult> {
  const client = await resolveLLMClient("writing", userId);
  if (!client) {
    return {
      passed: false,
      score: 0,
      issues: [{ rule: "audit_unavailable", severity: "critical", detail: "No writing model configured. Cannot perform audit." }],
      checkedAt: new Date().toISOString(),
    };
  }

  const { system, user } = buildAuditPrompt(title, content, keyPoints, docLocale);

  try {
    const response = await client.provider.chat({
      model: client.modelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
    });

    if (userId) {
      await recordTokenUsage({
        userId,
        modelConfigId: client.modelConfigId,
        module: "audit",
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        referenceId,
      }).catch((err) => { console.warn("Failed to record audit token usage:", err); });
    }

    return parseAuditResponse(response.content);
  } catch (error) {
    console.error("Section audit failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      passed: false,
      score: 0,
      issues: [
        { rule: "audit_error", severity: "critical", detail: `Audit execution failed: ${message}` },
      ],
      checkedAt: new Date().toISOString(),
    };
  }
}
