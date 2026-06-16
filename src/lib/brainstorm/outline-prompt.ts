import type { DocumentLanguage } from "@/lib/prompts";
import {
  composeArchetypeKey,
  getArchetypeSkeleton,
  normalizeArchetypeId,
  type ArchetypeSkeleton,
} from "@/lib/brainstorm/archetypes";

export function buildLightweightOutlinePrompt(archetype: string, locale: DocumentLanguage = "en"): string {
  const [rawPrimary, rawSecondary] = archetype.split("+");
  const primary = normalizeArchetypeId(rawPrimary) ?? "general";
  const secondary = normalizeArchetypeId(rawSecondary);
  const archetypeKey = composeArchetypeKey(primary, secondary);
  const effectiveSecondary = archetypeKey.includes("+") ? archetypeKey.split("+")[1] : null;

  const primarySkeleton = getArchetypeSkeleton(primary, locale) ?? getArchetypeSkeleton("general", locale);
  if (!primarySkeleton) {
    throw new Error("General archetype skeleton is not registered");
  }
  const secondarySkeleton = effectiveSecondary ? getArchetypeSkeleton(effectiveSecondary, locale) ?? null : null;

  if (locale === "zh-CN") {
    return buildOutlinePromptZH(primarySkeleton, primary, secondarySkeleton, effectiveSecondary);
  }
  return buildOutlinePromptEN(primarySkeleton, primary, secondarySkeleton, effectiveSecondary);
}

export function buildSkeletonOutlinePrompt(archetype: string, locale: DocumentLanguage = "en"): string {
  const [rawPrimary, rawSecondary] = archetype.split("+");
  const primary = normalizeArchetypeId(rawPrimary) ?? "general";
  const secondary = normalizeArchetypeId(rawSecondary);
  const archetypeKey = composeArchetypeKey(primary, secondary);
  const effectiveSecondary = archetypeKey.includes("+") ? archetypeKey.split("+")[1] : null;

  const primarySkeleton = getArchetypeSkeleton(primary, locale) ?? getArchetypeSkeleton("general", locale);
  if (!primarySkeleton) {
    throw new Error("General archetype skeleton is not registered");
  }
  const secondarySkeleton = effectiveSecondary ? getArchetypeSkeleton(effectiveSecondary, locale) ?? null : null;

  if (locale === "zh-CN") {
    return buildSkeletonPromptZH(primarySkeleton, primary, secondarySkeleton, effectiveSecondary);
  }
  return buildSkeletonPromptEN(primarySkeleton, primary, secondarySkeleton, effectiveSecondary);
}

export function buildEnrichmentPrompt(locale: DocumentLanguage = "en"): string {
  if (locale === "zh-CN") return ENRICHMENT_PROMPT_ZH;
  return ENRICHMENT_PROMPT_EN;
}

// ── Part-level markdown expansion (adaptive depth) ──
// One LLM call per part emits that part's full markdown outline. Heading depth
// (##/###/####/#####) is decided by the model per chapter based on content
// complexity — NOT a fixed depth. Parsed back into an OutlineSection tree by
// outline-markdown.ts. Sibling-part titles are injected into the user message
// (by the worker) to prevent cross-part duplication.
export function buildPartExpansionPrompt(locale: DocumentLanguage = "en"): string {
  if (locale === "zh-CN") return PART_EXPANSION_PROMPT_ZH;
  return PART_EXPANSION_PROMPT_EN;
}

const PART_EXPANSION_PROMPT_EN = `You are a document architect. Expand ONE part (篇) of a document outline into its full markdown outline (chapters, sections, subsections, and finer levels as the content requires).

## Output format
Emit pure markdown using heading levels. The number of '#' sets the depth:
- ## = chapter (first level under this part)
- ### = section
- #### = subsection
- ##### = finer level (use only when the content truly warrants it)

Right after each heading, put a "keyPoints:" line with 2-4 writing points separated by semicolons.

Example:
## Chapter Title
keyPoints: point 1; point 2; point 3
### Section Title
keyPoints: ...
#### Subsection Title
keyPoints: ...

## Rules
1. Decide the depth PER chapter by its content complexity — do NOT force a uniform depth across the whole part. A simple chapter may only need ## + ###; a complex core chapter may legitimately go to #### or #####. Follow what each topic needs.
2. ## = chapter under this part; ### = section; #### = subsection; ##### = finer.
3. Every heading needs a keyPoints line (2-4 points).
4. The headings together must cover the part's scope and total roughly its estimatedWords.
5. Avoid duplicating topics already covered by other parts (their titles are given as context).
6. Output ONLY markdown headings + keyPoints lines. No prose, no JSON, no leading numbers (the system renumbers).`;

const PART_EXPANSION_PROMPT_ZH = `你是文档架构师。将一篇（part）展开为它的完整 markdown 大纲（章、节、小节以及更细的层级，按内容需要）。

## 输出格式
只输出 markdown，用标题级别表示层级，'#' 的数量决定深度：
- ## = 章（本篇下的第一级）
- ### = 节
- #### = 小节
- ##### = 更细（仅在内容确实需要时使用）

每个标题下方紧跟一行 "keyPoints:"，给 2-4 个写作要点，用分号分隔。

示例：
## 章标题
keyPoints: 要点1；要点2；要点3
### 节标题
keyPoints: ...
#### 小节标题
keyPoints: ...

## 规则
1. 每一章的深度由它的内容复杂度决定 —— 不要在整个篇里强制统一深度。简单章节可能只需 ## + ###；复杂核心章节可以合理地到 #### 甚至 #####。跟随每个主题的实际需要。
2. ## = 本篇下的章；### = 节；#### = 小节；##### = 更细。
3. 每个标题都要有 keyPoints 行（2-4 个要点）。
4. 所有标题合起来要覆盖本篇范围，总字数大致达到本篇的 estimatedWords。
5. 避免与其他篇重复（其他篇的标题会作为上下文给出）。
6. 只输出 markdown 标题 + keyPoints 行。不要散文、不要 JSON、不要标题前缀编号（系统会重新编号）。`;

// ── Expansion prompt (generic, recursive): expand ONE parent node into its
// next-level children. Called once per non-leaf node at every depth (parts →
// chapters → sections → subsections). Each call emits only that node's children
// (~1-2K tokens), so output never truncates regardless of total outline size —
// this STORM-style hierarchical decomposition replaces the old "emit the entire
// outline in one JSON" approach that truncated at 4096 tokens.
const ENRICHMENT_PROMPT_EN = `You are a professional document architect. Expand ONE parent node of a document outline into its next-level children, each with full writing detail.

## Input
You receive: the document's requirements + ONE parent node (its "num", title, scope, and estimated word count).

## Instructions
1. Decompose the parent node into 3-5 cohesive children. Each child must be a single coherent topic at the next level down.
2. Child "num" = the parent's "num" + ".N". Examples: parent "1" -> "1.1","1.2"; parent "1.1" -> "1.1.1","1.1.2"; parent "1.1.1" -> "1.1.1.1","1.1.1.2".
3. The children together must cover the parent's scope and total roughly the parent's estimatedWords.
4. For EACH child provide:
   - "num": as described above (parent num + ".N")
   - "title": concise title
   - "description": one-sentence scope
   - "keyPoints": [2-4 core writing points]
   - "estimatedWords": target word count
   - "writingRequirements": concise hidden drafting instruction (coverage, angle, boundaries, style, diagram needs)
   - "retrievalQuery": a knowledge-base retrieval query string
   - "referenceHints": [entity / standard / framework keywords]
5. Do NOT include the parent node itself in the output. Output only its children.

## Output JSON Schema
Output JSON only (no other text):
{
  "sections": [
    { "num": "1.1", "title": "Child Title", "description": "Scope", "keyPoints": ["Point 1","Point 2"], "estimatedWords": 500, "writingRequirements": "Hidden drafting instruction", "retrievalQuery": "Search query", "referenceHints": ["keyword"] }
  ]
}`;

const ENRICHMENT_PROMPT_ZH = `你是专业的文档架构师。将文档大纲中的【一个父节点】展开为它的下一级子节点，并为每个子节点补充完整的撰写细节。

## 输入
你会收到：文档的整体需求 + 一个父节点（"num"、标题、范围、预估字数）。

## 指令
1. 将父节点拆解为 3-5 个连贯的子节点，每个是下一层级的一个独立主题。
2. 子节点 "num" = 父 "num" + ".N"。例：父 "1" → "1.1"、"1.2"；父 "1.1" → "1.1.1"、"1.1.2"；父 "1.1.1" → "1.1.1.1"、"1.1.1.2"。
3. 所有子节点合起来应完整覆盖父节点范围，总字数大致达到父节点的 estimatedWords。
4. 为【每个子节点】提供：
   - "num"：如上（父 num + ".N"）
   - "title"：简洁标题
   - "description"：一句话描述范围
   - "keyPoints"：[2-4 个核心写作要点]
   - "estimatedWords"：目标字数
   - "writingRequirements"：简洁的隐藏撰写指令（覆盖范围、论述角度、边界、风格、图表需求）
   - "retrievalQuery"：知识库检索查询
   - "referenceHints"：[实体/标准/框架关键词]
5. 输出中不要包含父节点本身，只输出它的子节点。

## 输出 JSON 格式
严格输出 JSON（不要添加其他文字）：
{
  "sections": [
    { "num": "1.1", "title": "子节点标题", "description": "范围", "keyPoints": ["要点 1","要点 2"], "estimatedWords": 500, "writingRequirements": "隐藏撰写指令", "retrievalQuery": "检索查询", "referenceHints": ["关键词"] }
  ]
}`;

function buildSkeletonPromptEN(
  primary: ArchetypeSkeleton,
  primaryType: string,
  secondary: ArchetypeSkeleton | null,
  secondaryType: string | null,
): string {
  const secondaryBlock = secondary
    ? `\nThis is a hybrid document. Also embed key sections from the secondary archetype "${secondaryType}":\n- Principle: ${secondary.principle}\n- Skeleton: ${secondary.skeleton}\n- Focus: ${secondary.focus}\n`
    : "";

  return `Generate the TOP-LEVEL part skeleton (level 1 = parts / 篇) for a document based on the structured requirements summary. The final outline is 4 levels deep: parts (1) -> chapters (1.1) -> sections (1.1.1) -> subsections (1.1.1.1). You generate ONLY level 1 (parts) here.

## Document Archetype: ${primaryType}

- **Principle:** ${primary.principle}
- **Skeleton:** ${primary.skeleton}
- **Focus:** ${primary.focus}
${secondaryBlock}
## Generation Instructions

1. Use the skeleton above as the structural foundation; adapt based on the requirements summary.
2. Generate ONLY top-level parts — exactly 4 to 8 parts. Each part is a major division that will later be expanded into chapters (1.1), sections (1.1.1), and subsections (1.1.1.1) by a separate process.
3. Do NOT generate any lower levels. No dotted numbers (no "1.1"), no "children", no nested nodes. Lower levels are expanded separately in a later stage — emitting them here causes the JSON to truncate against the token limit.
4. Use "num" with plain integers only: "1", "2", "3", ...
5. Each part must include: "num", "title", "description" (one-sentence scope), "estimatedWords" (the combined total of its future chapters/sections/subsections — for a long plan each part is typically several thousand words).

## Output JSON Schema

Output JSON only (no other text):
{
  "title": "Document Title",
  "documentType": "${primaryType}${secondaryType ? "+" + secondaryType : ""}",
  "sections": [
    { "num": "1", "title": "Part Name", "description": "Scope in one sentence", "estimatedWords": 5000 },
    { "num": "2", "title": "Next Part", "description": "Scope in one sentence", "estimatedWords": 6000 }
  ]
}`;
}

function buildSkeletonPromptZH(
  primary: ArchetypeSkeleton,
  primaryType: string,
  secondary: ArchetypeSkeleton | null,
  secondaryType: string | null,
): string {
  const secondaryBlock = secondary
    ? `\n这是混合型文档。还需嵌入次要原型"${secondaryType}"的关键章节：\n- 原则：${secondary.principle}\n- 骨架：${secondary.skeleton}\n- 重点：${secondary.focus}\n`
    : "";

  return `根据结构化需求摘要，生成文档的【篇/部分骨架】（第1级 = 篇/部分）。最终大纲为4级：篇(1) → 章(1.1) → 节(1.1.1) → 小节(1.1.1.1)。这里只生成第1级（篇）。

## 文档原型：${primaryType}

- **原则：** ${primary.principle}
- **骨架：** ${primary.skeleton}
- **重点：** ${primary.focus}
${secondaryBlock}
## 生成指令

1. 以以上骨架作为结构基础，根据需求摘要调整。
2. 只生成篇/部分 —— 恰好 4 到 8 个篇。每一篇是一个主要划分，后续会单独展开为章(1.1)、节(1.1.1)、小节(1.1.1.1)。
3. 不要生成任何下级。不要用点号编号（不要 "1.1"），不要 "children"，不要嵌套。下级会在后续阶段单独展开 —— 在这里输出下级会导致 JSON 超出 token 上限被截断。
4. "num" 只用纯整数："1"、"2"、"3"……
5. 每篇必须包含："num"、"title"、"description"（一句话范围）、"estimatedWords"（其未来章/节/小节的合计字数 —— 长方案中每篇通常数千字）。

## 输出 JSON 格式

严格输出 JSON（不要添加其他文字）：
{
  "title": "文档标题",
  "documentType": "${primaryType}${secondaryType ? "+" + secondaryType : ""}",
  "sections": [
    { "num": "1", "title": "篇名称", "description": "一句话描述范围", "estimatedWords": 5000 },
    { "num": "2", "title": "下一篇", "description": "一句话描述范围", "estimatedWords": 6000 }
  ]
}`;
}

function buildOutlinePromptEN(
  primary: ArchetypeSkeleton,
  primaryType: string,
  secondary: ArchetypeSkeleton | null,
  secondaryType: string | null,
): string {
  const secondaryBlock = secondary
    ? `\nThis is a hybrid document. Also embed key sections from the secondary archetype "${secondaryType}":\n- Principle: ${secondary.principle}\n- Skeleton: ${secondary.skeleton}\n- Focus: ${secondary.focus}\n`
    : "";

  return `Generate a complete document outline based on the structured requirements summary.

## Document Archetype: ${primaryType}

- **Principle:** ${primary.principle}
- **Skeleton:** ${primary.skeleton}
- **Focus:** ${primary.focus}
${secondaryBlock}
## Generation Instructions

1. Use the skeleton above as the structural foundation.
2. Adapt based on the requirements summary: add, remove, reorder, or rename sections as needed.
3. Extract confirmed chapter divisions, key points, and constraints from the summary.
4. Aim for a comprehensive outline with 2-3 levels of hierarchy, 4-8 top-level sections, and 15-30 leaf sections total. Each leaf section should target 300-800 words.
5. Create child sections for all meaningful semantic subtopics: modules, stages, objects, analysis dimensions, evidence groups, deliverables, risks, or responsibilities.
6. Do not put every topic at the top level. Unless the document is very short, top-level sections are major chapters only. Prefer deeper structure over flatter structure when the content warrants it.
7. Leaf sections should each cover a coherent topic writable as a single unit.

## Output Requirements

1. Each section must include \`keyPoints\` (2-4), cannot be empty
2. Each section must include a concise \`description\` explaining the section's scope and role
3. Each section must include \`writingRequirements\`: concise hidden drafting instructions for coverage, angle, boundaries, style, and diagram needs when relevant
4. Each section must include \`retrievalQuery\` and \`referenceHints\` for knowledge-base retrieval
5. Estimate \`estimatedWords\` per section based on content complexity
6. Num format reflects hierarchy: "1", "1.1", "1.1.1", etc.
7. Do not split headings only because estimatedWords is high; hierarchy must be justified by meaning and parent-child logic

## Output JSON Schema

Output JSON only (no other text):
{
  "title": "Document Title",
  "documentType": "${primaryType}${secondaryType ? "+" + secondaryType : ""}",
  "sections": [
    {
      "num": "1",
      "title": "Chapter Name",
      "description": "One-sentence chapter scope",
      "keyPoints": ["Point 1", "Point 2"],
      "estimatedWords": 1500,
      "writingRequirements": "Hidden drafting instruction: coverage, angle, boundaries, style, diagram needs if relevant",
      "retrievalQuery": "Search query for supporting knowledge",
      "referenceHints": ["entity/standard/framework"],
      "children": [
        {"num": "1.1", "title": "Sub-section", "description": "Scope", "keyPoints": ["Point"], "estimatedWords": 500, "writingRequirements": "Hidden drafting instruction", "retrievalQuery": "Search query", "referenceHints": ["keyword"], "children": []}
      ]
    }
  ]
}`;
}

function buildOutlinePromptZH(
  primary: ArchetypeSkeleton,
  primaryType: string,
  secondary: ArchetypeSkeleton | null,
  secondaryType: string | null,
): string {
  const secondaryBlock = secondary
    ? `\n这是混合型文档。还需嵌入次要原型"${secondaryType}"的关键章节：\n- 原则：${secondary.principle}\n- 骨架：${secondary.skeleton}\n- 重点：${secondary.focus}\n`
    : "";

  return `根据结构化需求摘要生成完整的文档大纲。

## 文档原型：${primaryType}

- **原则：** ${primary.principle}
- **骨架：** ${primary.skeleton}
- **重点：** ${primary.focus}
${secondaryBlock}
## 生成指令

1. 以以上骨架作为结构基础。
2. 根据需求摘要调整骨架：增加、删除、重排或重命名章节。
3. 从摘要中提取已确认的章节划分、要点和约束。
4. 目标为全面的大纲：2-3 层级深度，4-8 个一级章节，共 15-30 个叶子章节。每个叶子章节目标 300-800 字。
5. 为所有有意义的语义子主题生成子章节：模块、阶段、对象、分析维度、证据组、交付物、风险或职责。
6. 不要把所有主题都放在一级章节。除非文档非常短，一级章节只表示主要章，细分主题应放入 children。当内容需要时，优先使用更深的结构而非扁平结构。
7. 叶子章节应各覆盖一个可独立撰写的连贯主题。

## 输出要求

1. 每个章节必须包含 keyPoints（2-4 个），不能为空
2. 每个章节必须包含简洁的 description，说明章节的范围和作用
3. 每个章节必须包含 writingRequirements：简洁的隐藏撰写指令，说明覆盖范围、论述角度、章节边界、风格要求，以及相关时的图表需求
4. 每个章节必须包含 retrievalQuery 和 referenceHints，用于知识库检索
5. 估算每个章节的 estimatedWords
6. 编号必须体现层级："1"、"1.1"、"1.1.1" 等
7. 不要只因为某章节预估字数较多就拆标题。字数只能作为弱信号，层级必须由内容含义和父子逻辑决定

## 输出 JSON 格式

严格输出 JSON（不要添加其他文字）：
{
  "title": "文档标题",
  "documentType": "${primaryType}${secondaryType ? "+" + secondaryType : ""}",
  "sections": [
    {
      "num": "1",
      "title": "章节名称",
      "description": "一句话描述章节范围",
      "keyPoints": ["要点 1", "要点 2"],
      "estimatedWords": 1500,
      "writingRequirements": "隐藏撰写指令：覆盖范围、论述角度、章节边界、风格要求、相关时的图表需求",
      "retrievalQuery": "支撑该章节的知识库检索查询",
      "referenceHints": ["实体/标准/框架"],
      "children": [
        {"num": "1.1", "title": "子章节", "description": "范围", "keyPoints": ["要点"], "estimatedWords": 500, "writingRequirements": "隐藏撰写指令", "retrievalQuery": "检索查询", "referenceHints": ["关键词"], "children": []}
      ]
    }
  ]
}`;
}
