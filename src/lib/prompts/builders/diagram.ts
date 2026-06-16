import type { DocumentLanguage } from "../index";
import { EN_PROMPTS } from "../locales/en-prompts";
import { ZH_PROMPTS } from "../locales/zh-CN-prompts";

export function buildDiagramPrompts(locale: DocumentLanguage = "en"): {
  create: string;
  edit: string;
} {
  return {
    create: locale === "zh-CN" ? ZH_PROMPTS.diagramCreate : EN_PROMPTS.diagramCreate,
    edit: locale === "zh-CN" ? ZH_PROMPTS.diagramEdit : EN_PROMPTS.diagramEdit,
  };
}
