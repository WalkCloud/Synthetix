import { createLLMProvider } from "@/lib/llm/factory";
import { resolveModel } from "@/lib/llm/resolve-model";
import { recordTokenUsage } from "@/lib/llm/usage";
import type { ChatResponse } from "@/lib/llm/types";

/**
 * Anti-AI writing pattern detection and rewrite module.
 * Based on the Humanizer project (github.com/blader/humanizer) — 29 AI writing
 * patterns across 5 categories, with a two-pass self-audit rewrite process.
 */

const HUMANIZER_TEMPERATURE = 0.75;

const AUDIT_PROMPT = `You are an expert editor detecting AI-generated writing patterns. Analyze the text below and identify which of these 29 patterns appear:

**Content Patterns:**
1. Hedging language ("it's worth noting", "it's important to consider", "importantly")
2. Laundry-list structure (numbered lists replacing narrative flow)
3. Generic examples instead of specific ones
4. "In conclusion" / "In summary" / "To summarize" mechanical wrap-ups
5. Symmetrical paragraph lengths throughout
6. Safe, balanced takes that avoid commitment

**Language/Grammar Patterns:**
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

**Style Patterns:**
20. Every paragraph starts with a topic sentence
21. Transition sentences between every paragraph
22. Lists of exactly 3 items everywhere
23. Definitions followed by examples in the same rigid pattern
24. No voice — reads like an encyclopedia entry
25. Perfect grammar with zero personality

**Communication Patterns:**
26. Over-explaining obvious concepts
27. Restating the same point with different words
28. Apologizing or hedging before making a point ("While it may seem...")
29. Ending with a call-to-action or inspirational note

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
- Preserve all citations and references from source material
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
  const writingModel = await findWritingModel();
  const { provider, modelId, modelConfigId } = writingModel;

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
  }).catch(() => {});

  return {
    content: rewriteResponse.content,
    auditNotes: auditResponse.content,
    inputTokens: totalInput,
    outputTokens: totalOutput,
  };
}

async function findWritingModel() {
  const writingModel = await resolveModel("writing");

  if (writingModel?.provider) {
    return {
      provider: createLLMProvider({
        apiBaseUrl: writingModel.provider.apiBaseUrl,
        apiKey: writingModel.provider.apiKey,
      }),
      modelId: writingModel.modelId,
      modelConfigId: writingModel.id,
    };
  }

  throw new Error("No writing model configured for humanization.");
}
