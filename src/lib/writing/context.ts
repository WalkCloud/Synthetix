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
    writingRequirements?: string;
    retrievalQuery?: string;
    referenceHints?: string[];
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
      "- Use paragraphs and concise local sub-headings only when they improve readability.",
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
      "- Do not write phrases like \"introduce XXXX\", \"cite XXXX\", \"reference XXXX\", or \"according to XXXX\" unless the user explicitly asks for a literature-review or citation-heavy style.",
      "- Do not make the document sound like an AI-generated answer. It should read like final edited document prose.",
      "- Use concrete concepts, mechanisms, requirements, process descriptions, and conclusions where appropriate.",
      "- Vary paragraph length. Avoid repetitive paragraph structures.",
      "- Avoid unnecessary three-item lists when a paragraph would read better.",
      "- Avoid vague filler such as \"various methods\", \"multiple aspects\", \"comprehensive improvement\", \"robust support\", or \"empowering users\" unless made specific.",
      "- Do not over-explain obvious concepts.",
      "- Do not end with a generic inspirational summary or call to action.",
      "",
      "## HARD-BANNED WORDS (never use these):",
      "- additionally / tapestry / landscape / indelible mark / marks a milestone / undoubtedly / pivotal",
      "- vividly / synergistic / legacy / forge ahead / masterpiece / ingenious",
      "- spectacular / diverse and vibrant / leading the trend / revolutionary / leapfrog development",
      "- If you catch yourself using any of the above, rephrase immediately.",
      "",
      "## SOFT-CONSTRAINT WORDS (max 2 occurrences per paragraph without concrete evidence):",
      "- crucial / key / core / empower / enable / drive / lead / build",
      "- efficient / intelligent / comprehensive / one-stop / end-to-end / seamless",
      "- Each occurrence must be backed by specific data, metrics, or concrete examples.",
      "",
      "## PARAGRAPH RULES:",
      "- Each paragraph should be concise and substantive, roughly 80-300 words or the natural equivalent for the user's language.",
      "- Every paragraph must have a clear topic sentence or transitional phrase.",
      "- Avoid forced three-part structures.",
      "- Avoid repeated negative parallelisms such as \"not X but Y, not A but B\".",
      "- Avoid em-dash overuse. Use at most 1 em-dash per 500 characters.",
      "",
      "Structure rules:",
      "- Follow the target section scope. Do not write content for other chapters.",
      "- Do not repeat the target section title at the beginning of the output.",
      "- Do not output chapter numbers such as \"1\", \"1.2\", \"1.2.1\", or numbered Markdown headings.",
      "- Do not invent, rebuild, or renumber the document outline.",
      "- If local sub-headings are useful, write short unnumbered sub-headings that are not the target section title.",
      "- If the section is a parent or overview section, write a concise overview and avoid duplicating details that belong in child sections.",
      "- If the section is a leaf section, write the complete substantive content for that section.",
      "- Do not force a fixed template.",
      "- Preserve consistency with previous section summaries, but do not repeat them.",
      "",
      "Output rules:",
      "- Output only the final section content.",
      "- Start directly with the first paragraph of the section body.",
      "- Do not mention prompts, references, retrieval, RAG, context, source chunks, or model limitations.",
      "- Do not include analysis notes or explanations of writing choices.",
      "- Do not include a bibliography, citation list, or reference list unless the user explicitly requests one.",
      "- Produce output as plain text with Markdown formatting for structure.",
      "- Match the estimated word count as closely as possible without sacrificing quality.",
      "",
      "## DIAGRAM SYNTAX (use ONLY when explicitly instructed below)",
      "If the user message below explicitly asks you to include a diagram, embed it inline using this syntax:",
      "[DIAGRAM_REQUEST:",
      "type=<architecture|flowchart|data-flow|deployment|component|sequence|comparison|timeline|security>",
      "title=<diagram title>",
      "purpose=<what the diagram shows>",
      "placement=after_current_paragraph",
      "nodes=<comma-separated key entities>",
      "flows=<comma-separated relationships using ->>",
      "]",
      "Place the diagram block immediately after the paragraph that describes the relevant concept.",
      "Do NOT include a diagram unless the user message explicitly asks you to.",
    ].join("\n"),
  };
}

function buildOutlineSummary(
  draft: ContextInput["draft"],
  section: ContextInput["section"]
): string {
  const outlineEntries: string[] = [];

  outlineEntries.push(`Document: "${draft.title}"`);
  if (draft.description) {
    outlineEntries.push(`Description: ${draft.description}`);
  }

  try {
    const parsed = JSON.parse(draft.outline) as unknown;

    if (typeof parsed === "object" && parsed !== null && "sections" in parsed) {
      const outlineData = parsed as { sections: OutlineNode[] };
      const current = findOutlineNodeWithContext(
        outlineData.sections,
        section.title.replace(/^\d+(\.\d+)*\s*/, "").trim(),
      );
      const lines: string[] = ["Relevant Outline Context:"];
      if (current) {
        lines.push(`Current path: ${current.path.map((node) => `${node.num} ${node.title}`).join(" > ")}`);
        if (current.parent) {
          lines.push(`Parent section: ${current.parent.num} ${current.parent.title}`);
        }
        if (current.siblings.length > 0) {
          lines.push(
            `Sibling sections: ${current.siblings.map((node) => `${node.num} ${node.title}`).join("; ")}`
          );
        }
        if (current.node.children?.length) {
          lines.push(
            `Direct child sections to avoid duplicating: ${current.node.children.map((node) => `${node.num} ${node.title}`).join("; ")}`
          );
        }
      } else {
        lines.push(`Current section: ${section.title}`);
      }
      outlineEntries.push(lines.join("\n"));
    } else if (Array.isArray(parsed)) {
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

interface OutlineNode {
  num: string;
  title: string;
  children?: OutlineNode[];
}

interface OutlineNodeContext {
  node: OutlineNode;
  parent: OutlineNode | null;
  siblings: OutlineNode[];
  path: OutlineNode[];
}

function findOutlineNode(sections: OutlineNode[], cleanTitle: string): OutlineNode | null {
  for (const section of sections) {
    const currentTitle = section.title.replace(/^\d+(\.\d+)*\s*/, "").trim();
    if (currentTitle === cleanTitle) return section;
    if (section.children) {
      const found = findOutlineNode(section.children, cleanTitle);
      if (found) return found;
    }
  }
  return null;
}

function findOutlineNodeWithContext(
  sections: OutlineNode[],
  cleanTitle: string,
  parent: OutlineNode | null = null,
  path: OutlineNode[] = [],
): OutlineNodeContext | null {
  for (const section of sections) {
    const currentTitle = section.title.replace(/^\d+(\.\d+)*\s*/, "").trim();
    const currentPath = [...path, section];
    if (currentTitle === cleanTitle) {
      return {
        node: section,
        parent,
        siblings: sections.filter((item) => item !== section),
        path: currentPath,
      };
    }
    if (section.children) {
      const found = findOutlineNodeWithContext(
        section.children,
        cleanTitle,
        section,
        currentPath,
      );
      if (found) return found;
    }
  }
  return null;
}

function buildCompletedSectionsSummary(
  completedSections: ContextInput["completedSections"]
): string {
  const completed = completedSections.filter(
    (s) => ["completed", "locked", "summarized", "reviewing"].includes(s.status) && s.summary
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
    (ref, index) => {
      const docId = ref.documentId;
      const rewrittenContent = docId
        ? ref.content.replace(
            /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
            (_, alt, filename) => `![${alt}](/api/v1/documents/${docId}/images/${filename})`
          )
        : ref.content;
      return `### Reference ${index + 1} [Source: ${ref.documentName}, Relevance: ${(ref.score * 100).toFixed(0)}%]\n${rewrittenContent}`;
    }
  );

  return ["## Reference Material", "", ...entries].join("\n");
}

function buildTargetSectionBlock(section: ContextInput["section"], effectiveWordCount?: number | null): string {
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

  const wordCount = effectiveWordCount ?? section.estimatedWords;
  if (wordCount) {
    parts.push(`Target Word Count: approximately ${wordCount} words`);
  }

  return parts.join("\n");
}

function buildConstraintsBlock(
  constraints: NonNullable<ContextInput["constraints"]>
): string {
  const parts: string[] = ["## Additional Constraints"];

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

const DIAGRAM_KEYWORDS = [
  "architecture",
  "topology",
  "deployment architecture",
  "flowchart",
  "flow diagram",
  "data flow",
  "component diagram",
  "sequence",
  "layered architecture",
  "network model",
  "network topology",
  "microservice",
  "cluster deployment",
  "high availability",
  "disaster recovery",
  "end-to-end",
  "pipeline",
  "phased",
  "milestone timeline",
  "toolchain",
  "multi-tenant",
];

function sectionNeedsDiagram(section: ContextInput["section"]): boolean {
  const text = [
    section.title,
    section.description,
    section.keyPoints,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return DIAGRAM_KEYWORDS.some((kw) => new RegExp(kw, "i").test(text));
}

export function assembleContext(input: ContextInput): ChatMessage[] {
  const userParts: string[] = [];

  userParts.push(buildOutlineSummary(input.draft, input.section));

  const completedSummary = buildCompletedSectionsSummary(
    input.completedSections
  );
  if (completedSummary) {
    userParts.push("");
    userParts.push(completedSummary);
  }

  // detect if target section is a parent (has child sections in outline)
  let isParent = false;
  try {
    const parsed = JSON.parse(input.draft.outline) as unknown;
    if (typeof parsed === "object" && parsed !== null && "sections" in parsed) {
      const outlineData = parsed as { sections: OutlineNode[] };
      const cleanTitle = input.section.title.replace(/^\d+(\.\d+)*\s*/, "").trim();
      isParent = Boolean(findOutlineNode(outlineData.sections, cleanTitle)?.children?.length);
    }
  } catch {}

  const ragSection = buildRagReferencesSection(input.ragReferences);
  if (ragSection) {
    userParts.push("");
    userParts.push(ragSection);
  }

  userParts.push("");
  userParts.push(buildTargetSectionBlock(input.section, input.constraints?.wordLimit ?? input.section.estimatedWords));

  if (input.constraints) {
    userParts.push("");
    userParts.push(buildConstraintsBlock(input.constraints));
  }

  if (isParent) {
    userParts.push("");
    userParts.push(
      "IMPORTANT: This section has child subsections (indicated with ▶ in the outline above). Write a CONCISE OVERVIEW that introduces the topic scope at a high level. Do NOT write detailed content for child subsections — those will be generated separately under their own titles. Keep it brief (200-500 words recommended)."
    );
  } else {
    userParts.push("");
    userParts.push(
      "Write the final reader-facing content for the target section now. Use the reference material only as background support, and do not mention the reference material itself. Do not repeat the target section title or section number."
    );
  }

  if (sectionNeedsDiagram(input.section)) {
    userParts.push("");
    userParts.push(
      "The system has detected that this section covers a structural or visual topic. Please include ONE [DIAGRAM_REQUEST:...] block in your output after the paragraph that best describes the architecture/flow/topology. Use the syntax documented in the system prompt. If the section content ends up being conceptual rather than structural, you may skip the diagram."
    );
  }

  return [
    buildSystemMessage(),
    { role: "user", content: userParts.join("\n") },
  ];
}
