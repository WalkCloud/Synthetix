/**
 * LLM-guided heading structure refinement.
 *
 * After `splitByMacroAST` produces coarse macro-chunks via regex heuristics,
 * this module asks the writing LLM to review the candidate headings and
 * correct two classes of errors that regex cannot reliably detect:
 *
 * 1. False-positive titles — body text misidentified as section headings
 *    (shell commands, version tags, log output, ASCII art, IP addresses, etc.)
 * 2. Incorrect heading levels — Docling emits all headings as ## or ###,
 *    losing the document's true hierarchical structure.
 *
 * The LLM receives a COMPRESSED structural summary (heading paths + 80-char
 * previews), never full chunk content, so even a 1000-page document costs
 * a single low-token LLM call. On any failure (no model configured, API error,
 * unparseable response), the original macros are returned unchanged — making
 * this a non-blocking enhancement over the deterministic macro-split baseline.
 */
import { createLLMProvider } from "@/lib/llm/factory";
import { resolveLLMClient } from "@/lib/llm/client";
import { recordTokenUsage } from "@/lib/llm/usage";
import type { ChatParams } from "@/lib/llm/types";
import type { ProcessingContext } from "@/lib/documents/pipeline";
import { estimateTokens } from "@/lib/documents/splitter";
import type { MacroChunk } from "@/lib/documents/outline/macro-split";

const PREVIEW_MAX = 80;
const MAX_TOKENS_OUTPUT = 8192;

const REFINE_PROMPT = `You are a document structure analyst. Given a list of macro-chunks extracted from a document, identify which "headings" are real section titles and which are body text misidentified as titles.

Common false positives to reject:
- Shell commands: "bash setup.sh --ip-family ipv6", "docker rm -f ..."
- Version tags / image refs: "tag: v2.0.1", "image: 192.168..."
- Log output: "2022/03/23 03:43:02 [WARN] ..."
- Redis/SQL commands: "127.0.0.1:6379> info", "USER admin"
- ASCII art: "/  Alibaba Cloud  /  *  \\ | |"
- Table data rows, figure captions, list items

Also infer the correct heading LEVEL (1-4) for each real title:
- Level 1 = document's main sections (e.g. "1 项目建设背景", "Introduction")
- Level 2 = subsections (e.g. "1.1 银行业数字化转型", "Architecture")
- Level 3 = sub-subsections (e.g. "6.1.1 基础环境准备")
- Level 4 = deepest headings

Rules:
1. Preserve original ordering — do NOT merge, split, or reorder chunks.
2. If a heading is a false positive, set isTitle=false, level=0, title=null.
3. Keep the title text as-is for real headings (do NOT rewrite or translate).
4. Infer levels from numbering patterns and content hierarchy.

Return STRICT JSON only:
{
  "headings": [
    {"index": 0, "isTitle": true, "level": 1, "title": "项目建设背景"},
    {"index": 1, "isTitle": true, "level": 2, "title": "银行业数字化转型"},
    {"index": 2, "isTitle": false, "level": 0, "title": null}
  ]
}`;

interface MacroHeadingCandidate {
  index: number;
  currentH1: string;
  currentH2: string | null;
  headingPath: string;
  isAtomic: boolean;
  tokenCount: number;
  preview: string;
}

interface LlmHeadingResult {
  index: number;
  isTitle: boolean;
  level: number;
  title: string | null;
}

interface LlmHeadingPlan {
  headings: LlmHeadingResult[];
}

interface RefineLlm {
  provider: ReturnType<typeof createLLMProvider>;
  modelId: string;
  modelConfigId: string;
  userId: string;
}

async function resolveRefineLlm(ctx: ProcessingContext): Promise<RefineLlm | null> {
  if (ctx.writingModel?.provider) {
    return {
      provider: createLLMProvider({
        apiBaseUrl: ctx.writingModel.provider.apiBaseUrl,
        apiKey: ctx.writingModel.provider.apiKey,
        providerType: ctx.writingModel.provider.providerType,
      }),
      modelId: ctx.writingModel.modelId,
      modelConfigId: ctx.writingModel.id,
      userId: ctx.doc.userId,
    };
  }
  const resolved = await resolveLLMClient("writing", ctx.doc.userId);
  if (!resolved) return null;
  return {
    provider: resolved.provider,
    modelId: resolved.modelId,
    modelConfigId: resolved.modelConfigId,
    userId: ctx.doc.userId,
  };
}

function buildCandidates(macros: MacroChunk[]): MacroHeadingCandidate[] {
  return macros.map((m, i) => ({
    index: i,
    currentH1: m.h1,
    currentH2: m.h2,
    headingPath: m.headingPath,
    isAtomic: m.isAtomic,
    tokenCount: m.tokenCount,
    preview: m.content.replace(/\n/g, " ").trim().slice(0, PREVIEW_MAX),
  }));
}

function parseRefineResponse(content: string): LlmHeadingPlan | null {
  const trimmed = content.trim();
  // Strip markdown code fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonStr = candidate.slice(start, end + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || !Array.isArray(parsed.headings)) return null;
    return parsed as LlmHeadingPlan;
  } catch {
    // Lenient repair: strip trailing commas.
    try {
      const repaired = jsonStr.replace(/,(\s*[}\]])/g, "$1");
      const parsed = JSON.parse(repaired);
      if (!parsed || !Array.isArray(parsed.headings)) return null;
      return parsed as LlmHeadingPlan;
    } catch {
      return null;
    }
  }
}

/**
 * Apply LLM heading corrections to macro-chunks.
 *
 * Rebuilds h1/h2/headingPath for each macro based on the LLM's isTitle/level
 * verdict. Non-title chunks inherit the last valid heading context (they stay
 * in whatever section they were in). Title text is taken from the LLM result
 * when available, falling back to the original h1/h2.
 */
function applyRefinement(macros: MacroChunk[], plan: LlmHeadingPlan): MacroChunk[] {
  const resultMap = new Map<number, LlmHeadingResult>();
  for (const h of plan.headings) {
    if (typeof h.index === "number" && h.index >= 0 && h.index < macros.length) {
      resultMap.set(h.index, h);
    }
  }

  let lastValidH1 = "";
  let lastValidH2: string | null = null;

  // Detect garbage headingPaths — ones populated by CLI output / ASCII art
  // that leaked through isPlainTextTitle. Only reject paths that start with
  // clear non-heading characters (pipe, hash, slash). Numeric section titles
  // like "10 容器云平台使用规范" are valid and must NOT be rejected.
  function isGarbagePath(path: string): boolean {
    if (!path) return true;
    const first = path.split(" > ")[0];
    // Starts with pipe (ASCII art / table fragments)
    if (/^[|]/.test(first)) return true;
    // Is only "#" characters (ASCII art)
    if (/^#+$/.test(first)) return true;
    return false;
  }

  return macros.map((macro, i) => {
    const verdict = resultMap.get(i);

    // If this macro's content starts with a real markdown heading (## or #),
    // NEVER let the LLM demote it — the markdown structure is authoritative.
    // Only apply LLM corrections to plain-text heuristic titles.
    const hasMarkdownHeading = /^#{1,6}\s/.test(macro.content.trim());

    // If the headingPath is garbage (CLI output leaked in), try to recover
    // from any markdown heading anywhere in the content. The macro may contain
    // sub-section headings (####, #####) even if the ## chapter heading was
    // lost during coalescing — extract the chapter from the sub-section number.
    if (isGarbagePath(macro.headingPath)) {
      // First try ## (chapter-level) headings
      const h2match = macro.content.match(/^##\s+(.+)$/m);
      if (h2match) {
        const recoveredTitle = h2match[1].trim();
        lastValidH1 = recoveredTitle;
        lastValidH2 = null;
        return { ...macro, h1: recoveredTitle, h2: null, headingPath: recoveredTitle };
      }
      // No ## heading — try ### or #### sub-headings and extract the chapter.
      // e.g. "#### 10.1.1 业务集群管理规范" → chapter "10 容器云平台使用规范"
      // We approximate by taking the first number group as the chapter prefix.
      const subMatch = macro.content.match(/^#{3,6}\s+(\d+(?:\.\d+)*)\s+(.+)$/m);
      if (subMatch) {
        const fullNum = subMatch[1]; // e.g. "10.1.1"
        const chapterNum = fullNum.split(".")[0]; // e.g. "10"
        const sectionTitle = subMatch[2].trim(); // e.g. "业务集群管理规范"
        // Use the chapter number as the top-level topic. We don't know the
        // full chapter name, but "第N章" or just "N" is better than garbage.
        const recoveredTitle = `${chapterNum} ${sectionTitle.split(/\s/)[0]}`;
        lastValidH1 = recoveredTitle;
        lastValidH2 = null;
        return { ...macro, h1: recoveredTitle, h2: null, headingPath: recoveredTitle };
      }
    }

    if (!verdict || !verdict.isTitle) {
      if (hasMarkdownHeading) {
        // Real markdown heading — trust it even if LLM disagreed.
        // Update the heading context from the macro's existing h1/h2.
        if (macro.h1) { lastValidH1 = macro.h1; lastValidH2 = macro.h2; }
        return macro;
      }
      // Plain-text heuristic title demoted by LLM — inherit current section.
      return {
        ...macro,
        h1: lastValidH1 || macro.h1,
        h2: lastValidH2,
        headingPath: [lastValidH1, lastValidH2].filter(Boolean).join(" > ") || macro.headingPath,
      };
    }

    const title = verdict.title || macro.h2 || macro.h1;

    if (verdict.level <= 1) {
      lastValidH1 = title;
      lastValidH2 = null;
      return { ...macro, h1: title, h2: null, headingPath: title };
    }

    // Level 2+ — update h2, keep current h1.
    if (!lastValidH1) lastValidH1 = macro.h1;
    lastValidH2 = title;
    return {
      ...macro,
      h1: lastValidH1,
      h2: title,
      headingPath: [lastValidH1, title].filter(Boolean).join(" > "),
    };
  });
}

/**
 * LLM-enhanced heading structure refinement.
 *
 * Asks the writing LLM to review macro-chunk headings and correct false
 * positives (body text misidentified as titles) and heading levels. On any
 * failure — no model configured, API error, unparseable response — the
 * original macros are returned unchanged, making this a safe non-blocking
 * enhancement over the deterministic macro-split baseline.
 */
export async function llmRefineMacroStructure(
  macros: MacroChunk[],
  ctx: ProcessingContext,
): Promise<MacroChunk[]> {
  if (macros.length <= 1) return macros;

  const llm = await resolveRefineLlm(ctx);
  if (!llm) {
    console.log(`[llm-refine] doc ${ctx.docId}: no writing model configured, skipping (${macros.length} macros)`);
    return macros;
  }

  console.log(`[llm-refine] doc ${ctx.docId}: refining ${macros.length} macros with model ${llm.modelId}`);

  const candidates = buildCandidates(macros);
  const userContent = `Macro-chunk headings (JSON):\n${JSON.stringify(candidates)}`;

  const params: ChatParams = {
    model: llm.modelId,
    messages: [
      { role: "system", content: REFINE_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    maxTokens: MAX_TOKENS_OUTPUT,
  };

  let response;
  try {
    response = await llm.provider.chat(params);
  } catch (err) {
    console.warn(
      `[llm-refine] LLM call failed for doc ${ctx.docId}, using original macros:`,
      err instanceof Error ? err.message : err,
    );
    return macros;
  }

  const inputTokens = response.inputTokens ?? estimateTokens(userContent);
  const outputTokens = response.outputTokens ?? estimateTokens(response.content);
  void recordTokenUsage({
    userId: llm.userId,
    modelConfigId: llm.modelConfigId,
    module: "structure-refine",
    inputTokens,
    outputTokens,
    referenceId: ctx.docId,
  }).catch(() => undefined);

  const plan = parseRefineResponse(response.content);
  if (!plan) {
    const preview = response.content.slice(0, 300).replace(/\s+/g, " ");
    const finishReason = response.finishReason ? ` (finishReason=${response.finishReason})` : "";
    console.warn(
      `[llm-refine] unparseable response for doc ${ctx.docId}${finishReason}; ` +
        `inputTokens=${inputTokens} outputTokens=${outputTokens}; preview: "${preview}..."`,
    );
    return macros;
  }

  const refined = applyRefinement(macros, plan);
  console.log(`[llm-refine] doc ${ctx.docId}: refined ${plan.headings.length} headings (${inputTokens}+${outputTokens} tokens)`);
  return refined;
}
