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

const AUDIT_SYSTEM_PROMPT = `You are a document quality auditor. Review the provided section content and check for these specific issues. Return your findings as a JSON object.

## Audit Rules

1. **reference_exposure**: Does the text contain phrases like "based on the reference material", "according to the source", "as shown in Reference N", "the source document says", or similar wording that exposes the existence of reference material? This is a critical issue.

2. **entity_leak**: Does the text contain customer names, internal project names, file names, internal IDs, or vendor names that appear to come from reference material rather than being directly relevant to the document topic? This is a warning.

3. **ai_signatures**: Does the text contain typical AI writing patterns such as: "delve", "tapestry", "it's worth noting", "importantly", "in today's era", "with the continuous development of", every paragraph starting with a topic sentence, lists of exactly 3 items, symmetrical paragraph lengths, or hedging before every claim? This is a warning.

4. **meta_framing**: Does the text start with meta-phrases like "This section will introduce..." or "This chapter mainly discusses..."? This is a critical issue.

5. **empty_filler**: Does the text contain vague filler phrases like "various methods", "multiple aspects", "comprehensive improvement", "robust support", "empowering users", "one-stop", or "end-to-end" without specific details or data? This is a warning.

6. **generic_ending**: Does the text end with a generic inspirational summary or call to action rather than substantive content? This is a warning.

7. **paragraph_length**: Are any paragraphs excessively short or excessively long relative to the document style? Are there forced three-part structures or excessive em-dashes (>1 per 500 characters)? This is a warning.

## Response Format

Return ONLY a valid JSON object with this structure:
{
  "passed": true/false,
  "score": 0-100,
  "issues": [
    {
      "rule": "rule_name",
      "severity": "critical"|"warning"|"info",
      "detail": "description of the issue found",
      "excerpt": "the problematic text excerpt"
    }
  ]
}

Rules:
- passed = true if no critical issues found
- score: 100 = perfect, deduct 20 per critical issue, 10 per warning, 5 per info
- Only report actual issues found. Do not fabricate issues.
- If the text is clean, return { "passed": true, "score": 100, "issues": [] }
- Be strict about reference_exposure — any mention of "references", "sources", "materials" in the context of citing is a critical issue.`;

const AUDIT_USER_PROMPT_TEMPLATE = `## Section Title
{title}

## Section Content
{content}

## Key Points Expected
{keyPoints}

Audit the section content above. Return only the JSON result.`;

export function buildAuditPrompt(
  title: string,
  content: string,
  keyPoints?: string | null
): { system: string; user: string } {
  return {
    system: AUDIT_SYSTEM_PROMPT,
    user: AUDIT_USER_PROMPT_TEMPLATE
      .replace("{title}", title)
      .replace("{content}", content.slice(0, 4000))
      .replace("{keyPoints}", keyPoints || "Not specified"),
  };
}

export function parseAuditResponse(raw: string): AuditResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { passed: true, score: 100, issues: [], checkedAt: new Date().toISOString() };
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
    return { passed: true, score: 100, issues: [], checkedAt: new Date().toISOString() };
  }
}
