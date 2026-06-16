import type { DocumentLanguage } from "../index";
import { composePromptSkills, type PromptSkillId } from "../skills";

export interface WritingPromptOptions {
  needsDiagram?: boolean;
  isParentSection?: boolean;
}

export function buildWritingContext(
  locale: DocumentLanguage = "en",
  options: WritingPromptOptions = {},
): string {
  const skills: PromptSkillId[] = [
    "writing-base",
    "writing-reference-safety",
    "writing-section-boundary",
    "writing-anti-ai-style",
    options.isParentSection ? "writing-parent-overview" : "writing-leaf-section",
    "writing-output-format",
  ];

  if (options.needsDiagram) {
    skills.push("writing-diagram-request");
  }

  return composePromptSkills(locale, skills);
}
