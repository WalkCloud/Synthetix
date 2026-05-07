import type { ChatMessage } from "@/lib/llm/types";

export interface ContextInput {
  draft: {
    title: string;
    outline: string;
    description?: string | null;
  };
  section: {
    title: string;
    description?: string | null;
    keyPoints?: string | null;
    estimatedWords?: number | null;
  };
  completedSections: {
    title: string;
    summary: string | null;
    status: string;
  }[];
  ragReferences: {
    documentName: string;
    content: string;
    score: number;
  }[];
  constraints?: {
    referenceSections?: string[];
    wordLimit?: number;
    additionalRequirements?: string;
  } | null;
}

function buildSystemMessage(): ChatMessage {
  return {
    role: "system",
    content: [
      "You are a professional academic and technical writer producing long-form, reference-traceable documents.",
      "",
      "Writing guidelines:",
      "- Write in a clear, professional, and authoritative tone.",
      "- Support claims with specific references to the provided source material.",
      "- When citing information from reference chunks, attribute it naturally in the text (e.g., \"According to [Document Name]...\").",
      "- Maintain logical flow and coherence with previously completed sections.",
      "- Use precise language; avoid vagueness, hedging, or filler.",
      "- Structure content with appropriate headings, paragraphs, and transitions.",
      "- Do not fabricate references. Only cite material explicitly provided in the context.",
      "- Produce output as plain text with Markdown formatting for structure.",
      "- Match the estimated word count as closely as possible without sacrificing quality.",
      "",
      "Anti-AI writing rules (produce human-quality output):",
      "- Never use: delve, tapestry, realm, pivotal, foster, seamless, empower, robust, multifaceted, nuanced (as filler), leverage (as verb).",
      "- Never use filler transitions: \"it's worth noting\", \"importantly\", \"in conclusion\", \"to summarize\", \"navigating the landscape\".",
      "- Vary paragraph lengths — some should be 1-2 sentences, others longer. Break symmetry.",
      "- Make direct claims. Do not hedge with \"While it may seem...\" or \"It could be argued that...\" before every point.",
      "- Use specific numbers, names, dates, and examples — never \"various methods\" or \"multiple approaches\".",
      "- Do not pad with 3-item lists when a single strong statement suffices.",
      "- Write like a senior expert explaining to a colleague, not an encyclopedia.",
    ].join("\n"),
  };
}

function buildOutlineSummary(draft: ContextInput["draft"]): string {
  const outlineEntries: string[] = [];

  outlineEntries.push(`Document: "${draft.title}"`);
  if (draft.description) {
    outlineEntries.push(`Description: ${draft.description}`);
  }

  try {
    const parsed = JSON.parse(draft.outline) as unknown;
    if (Array.isArray(parsed)) {
      const sectionTitles = parsed
        .map((item: unknown, index: number) => {
          if (typeof item === "object" && item !== null && "title" in item) {
            return `  ${index + 1}. ${(item as { title: string }).title}`;
          }
          return `  ${index + 1}. ${String(item)}`;
        })
        .join("\n");
      outlineEntries.push(`Outline:\n${sectionTitles}`);
    } else {
      outlineEntries.push(`Outline: ${draft.outline}`);
    }
  } catch {
    outlineEntries.push(`Outline: ${draft.outline}`);
  }

  return outlineEntries.join("\n");
}

function buildCompletedSectionsSummary(
  completedSections: ContextInput["completedSections"]
): string {
  const completed = completedSections.filter(
    (s) => s.status === "completed" && s.summary
  );

  if (completed.length === 0) {
    return "";
  }

  const entries = completed.map(
    (s) => `### ${s.title}\n${s.summary}`
  );

  return [
    "## Previously Completed Sections (for continuity)",
    "",
    ...entries,
  ].join("\n");
}

function buildRagReferencesSection(
  references: ContextInput["ragReferences"]
): string {
  if (references.length === 0) {
    return "";
  }

  const sorted = [...references].sort((a, b) => b.score - a.score);

  const entries = sorted.map(
    (ref, index) =>
      `### Reference ${index + 1} [Source: ${ref.documentName}, Relevance: ${(ref.score * 100).toFixed(0)}%]\n${ref.content}`
  );

  return ["## Reference Material", "", ...entries].join("\n");
}

function buildTargetSectionBlock(section: ContextInput["section"]): string {
  const parts: string[] = [
    "## Target Section to Write",
    "",
    `Title: ${section.title}`,
  ];

  if (section.description) {
    parts.push(`Description: ${section.description}`);
  }

  if (section.keyPoints) {
    parts.push(`Key Points to Cover:\n${section.keyPoints}`);
  }

  if (section.estimatedWords) {
    parts.push(`Target Word Count: approximately ${section.estimatedWords} words`);
  }

  return parts.join("\n");
}

function buildConstraintsBlock(
  constraints: NonNullable<ContextInput["constraints"]>
): string {
  const parts: string[] = ["## Additional Constraints"];

  if (constraints.wordLimit) {
    parts.push(`Word Limit: Do not exceed ${constraints.wordLimit} words.`);
  }

  if (constraints.referenceSections && constraints.referenceSections.length > 0) {
    parts.push(
      `Prioritize these reference sections: ${constraints.referenceSections.join(", ")}`
    );
  }

  if (constraints.additionalRequirements) {
    parts.push(`Requirements: ${constraints.additionalRequirements}`);
  }

  return parts.join("\n");
}

export function assembleContext(input: ContextInput): ChatMessage[] {
  const userParts: string[] = [];

  userParts.push(buildOutlineSummary(input.draft));

  const completedSummary = buildCompletedSectionsSummary(
    input.completedSections
  );
  if (completedSummary) {
    userParts.push("");
    userParts.push(completedSummary);
  }

  const ragSection = buildRagReferencesSection(input.ragReferences);
  if (ragSection) {
    userParts.push("");
    userParts.push(ragSection);
  }

  userParts.push("");
  userParts.push(buildTargetSectionBlock(input.section));

  if (input.constraints) {
    userParts.push("");
    userParts.push(buildConstraintsBlock(input.constraints));
  }

  userParts.push("");
  userParts.push(
    "Write the complete content for the target section now. Follow all guidelines from the system instructions."
  );

  return [
    buildSystemMessage(),
    { role: "user", content: userParts.join("\n") },
  ];
}
