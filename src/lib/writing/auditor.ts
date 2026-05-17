import { resolveLLMClient } from "@/lib/llm/client";
import { buildAuditPrompt, parseAuditResponse, type AuditResult } from "./audit";

export async function auditSection(
  title: string,
  content: string,
  keyPoints?: string | null
): Promise<AuditResult> {
  const client = await resolveLLMClient("writing");
  if (!client) {
    return {
      passed: true,
      score: 100,
      issues: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const { system, user } = buildAuditPrompt(title, content, keyPoints);

  try {
    const response = await client.provider.chat({
      model: client.modelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
    });

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
