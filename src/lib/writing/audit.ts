import type { DocumentLanguage } from "@/lib/prompts";
import { buildAuditPrompts } from "@/lib/prompts";

export interface AuditIssue {
  rule: string;
  severity: "critical" | "warning" | "info";
  detail: string;
  excerpt?: string;
}

export interface AuditResult {
  passed: boolean;
  score: number;
  issues: AuditIssue[];
  checkedAt: string;
}

export function buildAuditPrompt(
  title: string,
  content: string,
  keyPoints?: string | null,
  docLocale: DocumentLanguage = "en",
): { system: string; user: string } {
  // Use localized prompts from the prompt registry
  const localized = buildAuditPrompts(title, content.slice(0, 4000), keyPoints, docLocale);
  return localized;
}

export function parseAuditResponse(raw: string): AuditResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        passed: false,
        score: 0,
        issues: [{ rule: "audit_parse_error", severity: "critical", detail: "Audit response did not contain valid JSON." }],
        checkedAt: new Date().toISOString(),
      };
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      passed?: boolean;
      score?: number;
      issues?: Array<{
        rule?: string;
        severity?: string;
        detail?: string;
        excerpt?: string;
      }>;
    };

    const issues: AuditIssue[] = (parsed.issues || [])
      .filter((i) => i.rule && i.detail)
      .map((i) => ({
        rule: i.rule || "unknown",
        severity: (i.severity as AuditIssue["severity"]) || "info",
        detail: i.detail || "",
        excerpt: i.excerpt,
      }));

    return {
      passed: parsed.passed !== false && !issues.some((i) => i.severity === "critical"),
      score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : 100,
      issues,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      passed: false,
      score: 0,
      issues: [{ rule: "audit_parse_error", severity: "critical", detail: "Failed to parse audit response JSON." }],
      checkedAt: new Date().toISOString(),
    };
  }
}
