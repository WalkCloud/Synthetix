import type { DocumentLanguage } from "@/lib/prompts";

export interface BrainstormMessageLike {
  role?: string;
  content: string;
}

const ZH_LENGTH_PATTERN = /篇幅|字数|页数|文档长度|报告长度|格式要求|简版|标准版|完整版|[0-9０-９一二三四五六七八九十百千万]+\s*(字|页)/i;
const EN_LENGTH_PATTERN = /word count|page count|document length|report length|format requirement|\b\d[\d,.]*\s*(words?|pages?|pp\.)\b|\b(brief|standard|full)\s+(version|length|document|report)\b/i;
const OPTION_REPLY_PATTERN = /^[ABCD](?:[\s,，.。:：]|$)/i;
const LENGTH_QUESTION_PATTERN = /篇幅|字数|页数|大致篇幅|word count|approximate length|page count|document length|report length/i;

export function hasExplicitLengthRequirement(content: string): boolean {
  return ZH_LENGTH_PATTERN.test(content) || EN_LENGTH_PATTERN.test(content);
}

function asksLengthRequirement(content: string): boolean {
  return LENGTH_QUESTION_PATTERN.test(content);
}

function isOptionReplyToPreviousLengthQuestion(
  current: BrainstormMessageLike,
  previous: BrainstormMessageLike | undefined,
): boolean {
  if (current.role && current.role !== "user") return false;
  if (!previous || previous.role !== "ai") return false;
  return OPTION_REPLY_PATTERN.test(current.content.trim()) && asksLengthRequirement(previous.content);
}

export function conversationHasLengthRequirement(messages: BrainstormMessageLike[]): boolean {
  return messages.some((message, index) =>
    hasExplicitLengthRequirement(message.content)
    || isOptionReplyToPreviousLengthQuestion(message, messages[index - 1])
  );
}

export function buildLengthRequirementQuestion(locale: DocumentLanguage = "en"): string {
  if (locale === "zh-CN") {
    return `在进入最终大纲生成方式选择前，还需要确认文档篇幅。

你期望这份文档的大致篇幅是多少？

A. 简版：约 2,000-3,000 字，适合快速汇报
B. 标准版：约 5,000-8,000 字，适合正式方案
C. 完整版：10,000 字以上，适合详细报告、投标文件或论文式材料
D. 其他：请说明页数、字数或格式要求`;
  }

  return `Before choosing the final outline generation mode, I need to confirm the document length.

What approximate length do you expect for this document?

A. Brief: about 2,000-3,000 words for a quick report
B. Standard: about 5,000-8,000 words for a formal proposal
C. Full: 10,000+ words for a detailed report, bid, or thesis-style document
D. Other: specify page count, word count, or required format`;
}
