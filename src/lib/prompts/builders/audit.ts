import type { DocumentLanguage } from "../index";
import { EN_PROMPTS } from "../locales/en-prompts";
import { ZH_PROMPTS } from "../locales/zh-CN-prompts";

export function buildAuditPrompts(
  title: string,
  content: string,
  keyPoints: string | undefined | null,
  locale: DocumentLanguage = "en",
): { system: string; user: string } {
  const system = locale === "zh-CN" ? ZH_PROMPTS.auditSystem : EN_PROMPTS.auditSystem;
  const userTemplate = locale === "zh-CN" ? ZH_PROMPTS.auditUser : EN_PROMPTS.auditUser;

  return {
    system,
    user: userTemplate
      .replace("{title}", title)
      .replace("{content}", content.slice(0, 4000))
      .replace("{keyPoints}", keyPoints || (locale === "zh-CN" ? "未指定" : "Not specified")),
  };
}
