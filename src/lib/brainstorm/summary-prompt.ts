import type { DocumentLanguage } from "@/lib/prompts";
import { getArchetypeChoices } from "@/lib/brainstorm/archetypes";

export const SUMMARY_PROMPTS = {
  en: `Analyze the brainstorming conversation and extract a structured requirements summary.

Output JSON only (no other text):
{
  "archetype": "primary archetype identifier from: {archetypeChoices}",
  "secondaryArchetype": "secondary archetype identifier if hybrid document, else null",
  "documentPurpose": "Document goal and real-world use",
  "targetAudience": "Target readers and decision makers. If not explicit, infer a conservative default from the document type and conversation.",
  "requiredScope": ["Scope item that must be covered"],
  "confirmedStructure": [
    {"title": "Confirmed section or major direction", "intent": "What this part should accomplish", "details": ["Specific point, module, evidence, or boundary"], "children": []}
  ],
  "keyTopics": ["Specific modules, analysis dimensions, objects, phases, risks, deliverables, or evidence groups"],
  "mustInclude": ["Non-negotiable content"],
  "mustAvoid": ["Content or angle to avoid"],
  "summary": "comprehensive requirement summary (3-5 sentences) covering all key requirements, scope, document purpose, and constraints discussed in the conversation",
  "confirmedSections": [
    {"title": "Section title from user's chosen direction", "intent": "What this section should cover"}
  ],
  "constraints": {
    "tone": "Desired writing tone, inferred conservatively if not explicit",
    "depth": "Expected depth level, inferred conservatively if not explicit",
    "lengthHint": "Overall length expectation if mentioned",
    "audience": "Target audience, inferred conservatively if not explicit",
    "boundaries": ["What to emphasize or avoid"]
  }
}

Rules:
- Extract only confirmed or clearly decided information — not AI questions or hypothetical options
- confirmedSections and confirmedStructure must reflect the outline direction the user explicitly chose, not every suggestion AI made
- Preserve hierarchy, section descriptions, key points, section-specific details, boundaries, evidence needs, and user refinements whenever present
- When inferring missing tone/depth/audience, use conservative defaults and do not invent domain facts
- If the user uploaded documents, extract key facts and requirements from them
- Be concise — this summary is an intermediate artifact for outline generation, not user-facing`,

  "zh-CN": `分析头脑风暴对话并提取结构化需求摘要。

仅输出 JSON（不要添加其他文字）：
{
  "archetype": "主文档原型标识，从以下选择：{archetypeChoices}",
  "secondaryArchetype": "混合型文档的次要原型标识，否则为 null",
  "documentPurpose": "文档目标和实际用途",
  "targetAudience": "目标读者和决策者。如未明确说明，基于文档类型和对话保守推断",
  "requiredScope": ["必须覆盖的范围项"],
  "confirmedStructure": [
    {"title": "已确认的章节或主要方向", "intent": "该部分要达成的目的", "details": ["具体要点、模块、证据或边界"], "children": []}
  ],
  "keyTopics": ["具体模块、分析维度、对象、阶段、风险、交付物或证据组"],
  "mustInclude": ["必须包含的内容"],
  "mustAvoid": ["需要避免的内容或角度"],
  "summary": "全面的需求摘要（3-5 句），涵盖对话中讨论的所有关键需求、范围、文档目的和约束条件",
  "confirmedSections": [
    {"title": "用户选择方向中的章节标题", "intent": "该章节应覆盖的内容"}
  ],
  "constraints": {
    "tone": "期望的写作语气，未明确时保守推断",
    "depth": "期望的深度级别，未明确时保守推断",
    "lengthHint": "整体篇幅预期（如提到）",
    "audience": "目标读者，未明确时保守推断",
    "boundaries": ["需要强调或避免的内容"]
  }
}

规则：
- 仅提取已确认或明确决定的信息，不包含 AI 提问或假设选项
- confirmedSections 和 confirmedStructure 必须反映用户明确选择的大纲方向，而非 AI 给出的所有建议
- 尽量保留层级、章节描述、关键点、章节细节、边界、证据要求和用户逐章细化内容
- 推断语气、深度、受众时使用保守默认值，不要编造领域事实
- 如用户上传了文档，从中提取关键事实和需求
- 简洁——此摘要为大纲生成的中间产物，非面向用户`,
};

export function buildSummaryPrompt(locale: DocumentLanguage = "en"): string {
  const effectiveLocale = locale === "zh-CN" ? "zh-CN" : "en";
  const template = effectiveLocale === "zh-CN" ? SUMMARY_PROMPTS["zh-CN"] : SUMMARY_PROMPTS.en;
  return template.replace("{archetypeChoices}", getArchetypeChoices(effectiveLocale));
}

export interface ConversationSummary {
  archetype: string;
  secondaryArchetype: string | null;
  documentPurpose?: string;
  targetAudience?: string;
  requiredScope?: string[];
  confirmedStructure?: Array<{ title: string; intent: string; details?: string[]; children?: unknown[] }>;
  keyTopics?: string[];
  mustInclude?: string[];
  mustAvoid?: string[];
  summary: string;
  confirmedSections: Array<{ title: string; intent: string }>;
  constraints: {
    tone?: string;
    depth?: string;
    lengthHint?: string;
    audience?: string;
    boundaries?: string[];
  };
}
