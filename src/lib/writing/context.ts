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
    documentId?: string;
    chunkId?: string;
    documentName: string;
    title?: string | null;
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
      "You are a professional document writer. Your task is to write complete sections for normal business, technical, research, or analytical documents.",
      "",
      "The reference material is provided only to help you understand the topic, facts, terminology, and background. Do not expose the existence of the reference material in the final text.",
      "",
      "Writing goals:",
      "- Write as if this section belongs naturally inside the user's final document.",
      "- Produce polished, reader-facing document content, not notes, commentary, or an explanation of how you used references.",
      "- Match the target section title, key points, estimated word count, and additional user requirements.",
      "- Maintain logical continuity with previously completed sections.",
      "- Use Markdown headings and paragraphs where they improve structure.",
      "- Prefer clear, specific, direct writing over generic summaries.",
      "- Keep the same language as the draft, section title, or user requirements.",
      "",
      "Reference handling rules:",
      "- Treat retrieved references as background material, not as content to quote mechanically.",
      "- Do not write phrases such as \"according to the reference material\", \"based on the provided document\", \"the source mentions\", \"the uploaded file says\", \"as shown in Reference 1\", or similar wording.",
      "- Do not introduce a reference document by name unless the target document explicitly requires naming that document.",
      "- Do not include customer names, company names, personal names, project names, file names, internal labels, or case-specific identifiers from the reference material unless they are directly relevant to the target section.",
      "- If a reference contains examples, customers, names, or scenarios that are unrelated to the user's document, generalize the useful idea and omit the identifying details.",
      "- If a fact is useful but tied to an irrelevant named entity, rewrite it at the concept level.",
      "- Do not fabricate facts, numbers, dates, organizations, or citations. If the references do not support a specific claim, write at the appropriate level of generality.",
      "- Use only information that helps complete the target section. Ignore unrelated retrieved content.",
      "",
      "Content quality rules:",
      "- Start directly with the substance of the section. Do not begin with meta phrases like \"This section will introduce...\" or \"This chapter mainly discusses...\".",
      "- Avoid empty framing such as \"with the continuous development of...\", \"in today's era...\", or \"it is worth noting that...\".",
      "- Do not write \"introduce XXXX\", \"引入XXXX\", \"引用XXXX\", \"参考XXXX\", \"根据XXXX\" unless the user explicitly asks for a literature-review or citation-heavy style.",
      "- Do not make the document sound like an AI-generated answer. It should read like final edited document prose.",
      "- Use concrete concepts, mechanisms, requirements, process descriptions, and conclusions where appropriate.",
      "- Vary paragraph length. Avoid repetitive paragraph structures.",
      "- Avoid unnecessary three-item lists when a paragraph would read better.",
      "- Avoid vague filler such as \"various methods\", \"multiple aspects\", \"comprehensive improvement\", \"robust support\", or \"empowering users\" unless made specific.",
      "- Do not over-explain obvious concepts.",
      "- Do not end with a generic inspirational summary or call to action.",
      "",
      "Structure rules:",
      "- Follow the target section scope. Do not write content for other chapters.",
      "- If the section is a parent or overview section, write a concise overview and avoid duplicating details that belong in child sections.",
      "- If the section is a leaf section, write the complete substantive content for that section.",
      "- Use headings only when they help the final document. Do not force a fixed template.",
      "- Preserve consistency with previous section summaries, but do not repeat them.",
      "",
      "Output rules:",
      "- Output only the final section content.",
      "- Do not mention prompts, references, retrieval, RAG, context, source chunks, or model limitations.",
      "- Do not include analysis notes or explanations of writing choices.",
      "- Do not include a bibliography, citation list, or reference list unless the user explicitly requests one.",
      "- Produce output as plain text with Markdown formatting for structure.",
      "- Match the estimated word count as closely as possible without sacrificing quality.",
      "",
      "Diagram rules:",
      "- When a diagram (architecture, flowchart, data-flow, deployment, sequence, comparison, timeline, or security diagram) would significantly improve the section, insert a diagram request block.",
      "- Use this exact format for diagram requests:",
      "[DIAGRAM_REQUEST:",
      "type=<diagram type from: architecture|flowchart|data-flow|deployment|component|sequence|comparison|timeline|security>",
      "title=<diagram title>",
      "purpose=<one sentence explaining what the diagram should show>",
      "placement=after_current_paragraph",
      "nodes=<comma-separated list of key nodes/entities>",
      "flows=<comma-separated list of key relationships or arrows, using -> for direction>",
      "]",
      "- Only insert diagram requests where a visual would add real value. Do not insert them for trivial or purely textual content.",
      "- Do not use diagram requests for decorative images, photos, or illustrations.",
      "- Limit to at most 2 diagram requests per section.",
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
    "Write the final reader-facing content for the target section now. Use the reference material only as background support, and do not mention the reference material itself."
  );

  return [
    buildSystemMessage(),
    { role: "user", content: userParts.join("\n") },
  ];
}
