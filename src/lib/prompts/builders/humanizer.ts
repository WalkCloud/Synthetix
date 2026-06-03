import type { DocumentLanguage } from "../index";
import { EN_PROMPTS } from "../locales/en-prompts";
import { ZH_PROMPTS } from "../locales/zh-CN-prompts";

export function buildHumanizerPrompts(locale: DocumentLanguage = "en"): {
  audit: string;
  rewrite: string;
} {
  return {
    audit: locale === "zh-CN" ? ZH_PROMPTS.humanizerAudit : EN_PROMPTS.humanizerAudit,
    rewrite: locale === "zh-CN" ? ZH_PROMPTS.humanizerRewrite : EN_PROMPTS.humanizerRewrite,
  };
}
