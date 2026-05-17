import { getLLMClient } from "@/lib/llm/client";
import { recordTokenUsage } from "@/lib/llm/usage";
import type { ChatResponse } from "@/lib/llm/types";

/**
 * Anti-AI writing pattern detection and rewrite module.
 * Based on the Humanizer project (github.com/blader/humanizer) — 29 AI writing
 * patterns across 5 categories, with a two-pass self-audit rewrite process.
 */

const HUMANIZER_TEMPERATURE = 0.75;

const AUDIT_PROMPT = `You are an expert editor detecting AI-generated writing patterns. Analyze the text below and identify which of these 35 patterns appear:

**Content Patterns:**
1. Hedging language ("it's worth noting", "it's important to consider", "importantly")
2. Laundry-list structure (numbered lists replacing narrative flow)
3. Generic examples instead of specific ones
4. "In conclusion" / "In summary" / "To summarize" mechanical wrap-ups
5. Symmetrical paragraph lengths throughout
6. Safe, balanced takes that avoid commitment

**Language/Grammar Patterns (English):**
7. "Delve" / "delves" — the hallmark AI verb
8. "Tapestry" / "rich tapestry" / "intricate tapestry"
9. "Navigating [abstract concept]" — "navigating the landscape", "navigating challenges"
10. "Realm" / "realm of" — "in the realm of technology"
11. "Pivotal" / "paramount" / "crucial" overuse
12. "Foster" / "fostered" / "fostering"
13. "Underscores" / "highlights" / "emphasizes" repeated
14. "Leverage" used as verb for everything
15. "Multifaceted" / "nuanced" / "comprehensive"
16. "Seamless" / "seamlessly"
17. "Empower" / "empowering"
18. "Innovative" / "cutting-edge" / "groundbreaking"
19. "Robust" / "scalable" / "dynamic"

**Language/Grammar Patterns (Chinese):**
20. Hard-banned words: 此外, 织锦, 格局, 标志着, 毋庸置疑, 举足轻重, 淋漓尽致, 相得益彰, 薪火相传, 砥砺前行
21. Soft-constraint overuse (≥3/paragraph without evidence): 至关重要, 关键, 核心, 赋能, 助力, 驱动, 引领, 打造, 高效, 智能
22. Negative parallelisms: "不是...而是...不是...而是..."
23. Forced tripartite: "不仅...还...更..."
24. Em-dash overuse: more than 1 per 500 characters

**Style Patterns:**
25. Every paragraph starts with a topic sentence
26. Transition sentences between every paragraph
27. Lists of exactly 3 items everywhere
28. Definitions followed by examples in the same rigid pattern
29. No voice — reads like an encyclopedia entry
30. Perfect grammar with zero personality

**Communication Patterns:**
31. Over-explaining obvious concepts
32. Restating the same point with different words
33. Apologizing or hedging before making a point ("While it may seem...")
34. Ending with a call-to-action or inspirational note
35. Paragraphs outside 80-300 Chinese character range

For each pattern found, quote the specific text and explain why it feels AI-generated. Be thorough — your audit determines rewrite quality.

Output format:
## Detected Patterns
For each found pattern:
- **Pattern [number]: [name]** — Quote: "..." — Why: [explanation]

## Summary
Overall AI feel: [Low/Medium/High]
Top 3 patterns to fix: [list]`;

const REWRITE_PROMPT = `You are an expert human writer. Rewrite the following text to eliminate all AI-generated patterns identified in the audit.

## Writing Rules
- Write like a real person who knows their subject deeply
- Have opinions — don't hedge every statement
- Vary sentence and paragraph length dramatically
- Use concrete details, specific examples, real numbers
- Drop filler words and get to the point
- Let some sentences be short. Even one word.
- Use the active voice aggressively
- Break patterns — if three paragraphs are similar length, make one a single line
- Reference specific tools, dates, people, places — not "various methods" or "multiple approaches"
- Maintain all factual content and technical accuracy from the original
- Preserve all factual content and technical accuracy from the original, but do not reintroduce source material references or citations that the original text does not contain
- Preserve any [DIAGRAM_REQUEST:...] blocks exactly as they are. Do not modify, paraphrase, or remove them.
- Keep the same language (Chinese/English) as the original

## Tone
- Authoritative but conversational
- Like a senior expert explaining to a colleague, not a textbook
- Direct statements over qualifications
- Specific details over generalizations

## Anti-Pattern Checklist
Before finalizing, verify NONE of these remain:
  - "delve", "tapestry", "realm", "pivotal", "foster", "seamless", "empower", "robust", "multifaceted"
  - "it's worth noting", "importantly", "in conclusion"
  - Chinese hard-banned: 此外, 织锦, 格局, 标志着, 毋庸置疑, 举足轻重, 淋漓尽致, 相得益彰, 薪火相传, 砥砺前行
  - Chinese soft-constraint overuse: 至关重要, 赋能, 助力, 驱动, 引领 (max 2 per paragraph)
  - Every paragraph starting with a topic sentence
- Lists of exactly 3 items
- Hedging before every claim
- Symmetrical paragraph lengths

Produce the rewritten text only — no meta-commentary, no explanations of what you changed.`;

export interface HumanizeResult {
  content: string;
  auditNotes: string;
  inputTokens: number;
  outputTokens: number;
}

export async function humanizeContent(
  content: string,
  sectionTitle: string,
  userId: string
): Promise<HumanizeResult> {
  const { provider, modelId, modelConfigId } = await getLLMClient("writing");

  // Pass 1: Audit — detect AI patterns
  const auditResponse = await provider.chat({
    model: modelId,
    messages: [
      { role: "system", content: AUDIT_PROMPT },
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
      { role: "system", content: REWRITE_PROMPT },
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

  await recordTokenUsage({
    userId,
    modelConfigId,
    module: "writing",
    inputTokens: totalInput,
    outputTokens: totalOutput,
  }).catch((err) => { console.warn("Failed to record token usage:", err); });

  return {
    content: rewriteResponse.content,
    auditNotes: auditResponse.content,
    inputTokens: totalInput,
    outputTokens: totalOutput,
  };
}

