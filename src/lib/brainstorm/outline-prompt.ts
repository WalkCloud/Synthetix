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
