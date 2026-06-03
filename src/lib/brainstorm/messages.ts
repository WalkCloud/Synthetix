import type { Locale } from "@/lib/i18n/constants";

const DEFAULT_TITLES = ["New Brainstorming Session", "新的思路梳理会话"];

export function resolveBrainstormLocale(value: string | null | undefined): Locale | null {
  if (value === "zh-CN" || value === "en") return value;
  return null;
}

export function isDefaultBrainstormTitle(title: string): boolean {
  return DEFAULT_TITLES.includes(title);
}

export function getBrainstormMessages(locale: Locale) {
  if (locale === "zh-CN") {
    return {
      defaultTitle: "新的思路梳理会话",
      sessionCreated: "新的思路梳理会话已创建。请描述你的文档写作需求。",
      outlineReady: "大纲已生成，可以查看和调整。",
      uploadSystem: (fileName: string) => `用户上传了文档“${fileName}”，内容已提取。`,
      uploadUser: (fileName: string, content: string) =>
        `我上传了文档“${fileName}”，请基于以下内容帮我构建文档大纲：\n\n${content}`,
    };
  }

  return {
    defaultTitle: "New Brainstorming Session",
    sessionCreated: "A new brainstorming session has been created. Please describe your document writing needs.",
    outlineReady: "Outline generated and ready for review.",
    uploadSystem: (fileName: string) => `User uploaded document "${fileName}", content extracted.`,
    uploadUser: (fileName: string, content: string) =>
      `I uploaded a document "${fileName}", please help me build a document outline based on the following content:\n\n${content}`,
  };
}
