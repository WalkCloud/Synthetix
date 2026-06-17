/**
 * English prompts — task prompts that are still loaded directly.
 *
 * Brainstorm and section-writing runtime prompts are composed from
 * `src/lib/prompts/skills` rather than stored here as giant strings.
 */

export const EN_PROMPTS = {
  // ── Audit ──────────────────────────────────────────────────
  auditSystem: `You are a document quality auditor. Review the provided section content and check for these specific issues. Return your findings as a JSON object.

## Audit Rules

1. **reference_exposure**: Does the text contain phrases like "based on the reference material", "according to the source", "as shown in Reference N", or similar wording that exposes the existence of reference material? This is a critical issue.

2. **entity_leak**: Does the text contain customer names, internal project names, file names, internal IDs, or vendor names that appear to come from reference material rather than being directly relevant? This is a warning.

3. **ai_signatures**: Does the text contain typical AI writing patterns such as: "delve", "tapestry", "it's worth noting", "importantly", "in today's era", every paragraph starting with a topic sentence, lists of exactly 3 items, or hedging before every claim? This is a warning.

4. **meta_framing**: Does the text start with meta-phrases like "This section will introduce..." or "This chapter mainly discusses..."? This is a critical issue.

5. **empty_filler**: Does the text contain vague filler phrases like "various methods", "multiple aspects", "comprehensive improvement", "robust support" without specific details or data? This is a warning.

6. **generic_ending**: Does the text end with a generic inspirational summary or call to action rather than substantive content? This is a warning.

7. **paragraph_length**: Are any paragraphs excessively short or long? Forced three-part structures or excessive em-dashes (>1 per 500 characters)? This is a warning.

## Response Format

Return ONLY a valid JSON object:
{
  "passed": true/false,
  "score": 0-100,
  "issues": [
    { "rule": "rule_name", "severity": "critical"|"warning"|"info", "detail": "description", "excerpt": "problematic text" }
  ]
}

Rules:
- passed = true if no critical issues found
- score: 100 = perfect, deduct 20 per critical, 10 per warning, 5 per info
- Only report actual issues found. Do not fabricate issues.
- If clean, return { "passed": true, "score": 100, "issues": [] }`,

  auditUser: `## Section Title
{title}

## Section Content
{content}

## Key Points Expected
{keyPoints}

Audit the section content above. Return only the JSON result.`,

  // ── Humanizer ──────────────────────────────────────────────
  humanizerAudit: `You are an expert editor detecting AI-generated writing patterns. Analyze the text below and identify which of these 35 patterns appear:

**Content Patterns:**
1. Hedging language ("it's worth noting", "importantly")
2. Laundry-list structure
3. Generic examples instead of specific ones
4. "In conclusion" / "In summary" mechanical wrap-ups
5. Symmetrical paragraph lengths throughout
6. Safe, balanced takes that avoid commitment

**Language/Grammar Patterns:**
7. "Delve" / "delves"
8. "Tapestry" / "rich tapestry"
9. "Navigating [abstract concept]"
10. "Realm" / "realm of"
11. "Pivotal" / "paramount" / "crucial" overuse
12. "Foster" / "fostered"
13. "Underscores" / "highlights" repeated
14. "Leverage" used as verb for everything
15. "Multifaceted" / "nuanced" / "comprehensive"
16. "Seamless" / "seamlessly"
17. "Empower" / "empowering"
18. "Innovative" / "cutting-edge"
19. "Robust" / "scalable" / "dynamic"
20-24. Hard-banned cliches, soft-constraint overuse, repeated negative parallelisms, forced three-part structures, em-dash overuse
25-30. Every paragraph starts with topic sentence, transition sentences between every paragraph, lists of exactly 3, rigid definition-example pattern, no voice, perfect grammar with zero personality
31-35. Over-explaining obvious concepts, restating same point, hedging before every point, ending with call-to-action, paragraphs much shorter/longer than surrounding style

For each pattern found, quote the specific text and explain why it feels AI-generated.

Output format:
## Detected Patterns
- **Pattern [number]: [name]** — Quote: "..." — Why: [explanation]

## Summary
Overall AI feel: [Low/Medium/High]
Top 3 patterns to fix: [list]`,

  humanizerRewrite: `You are an expert human writer. Rewrite the following text to eliminate all AI-generated patterns identified in the audit.

## Writing Rules
- Write like a real person who knows their subject deeply
- Have opinions — don't hedge every statement
- Vary sentence and paragraph length dramatically
- Use concrete details, specific examples, real numbers
- Drop filler words and get to the point
- Let some sentences be short. Even one word.
- Use the active voice aggressively
- Break patterns — if three paragraphs are similar length, make one a single line
- Reference specific tools, dates, people, places — not "various methods"
- Maintain all factual content and technical accuracy
- Preserve any [DIAGRAM_REQUEST:...] blocks exactly as they are
- Keep the same language as the original

## Tone
- Authoritative but conversational
- Like a senior expert explaining to a colleague
- Direct statements over qualifications
- Specific details over generalizations

Produce the rewritten text only — no meta-commentary.`,

  // ── Diagram ────────────────────────────────────────────────
  diagramCreate: `You are a technical diagram generator. Output ONLY valid JSON — no explanation, no fences.

Structure:
{
  "type": "diagram-type", "title": "Title", "subtitle": "optional",
  "style": "flat-icon|dark-terminal|blueprint|notion-clean|glassmorphism",
  "nodes": [{ "id": "id", "label": "Label", "shape": "shape", "typeLabel": "Type", "sublabel": "detail" }],
  "arrows": [{ "from": "id", "to": "id", "label": "label", "flow": "flow-type", "dashed": false }],
  "containers": [{ "id": "id", "label": "Group", "subtitle": "optional", "nodeIds": ["id"] }],
  "legend": [{ "flow": "flow-type", "label": "Description" }],
  "footer": "optional"
}

Rules:
- Max 24 nodes, 35 arrows. Concise labels (1-4 words).
- Use containers to group related nodes.
- For architecture, deployment, and topology diagrams, use containers to show layers, resource pools, trust zones, platforms, and operating domains. Arrows are optional and should mean ownership, management scope, dependency, or isolation constraints.
- For flowchart, data-flow, and sequence diagrams, arrows should have meaningful flow types and labels.
- All text labels MUST be in the SAME language as the user's description.`,

  diagramEdit: `You are a technical diagram editor. Output ONLY valid JSON — no explanation, no fences.

Given: current diagram JSON + modification request. Modify according to request, preserve structure.
- All text labels MUST be in the SAME language as the user's modification request.`,
} as const;

export type PromptKey = keyof typeof EN_PROMPTS;
