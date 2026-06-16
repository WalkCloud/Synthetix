import type { ChatMessage } from "@/lib/llm/types";
import { buildWritingContext, type DocumentLanguage } from "@/lib/prompts";
import { sectionNeedsDiagram } from "@/lib/writing/diagram-requirements";

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
    sourceType?: "rag_chunk" | "rag_graph";
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

const COMPLETED_SUMMARIES_TOTAL_CHAR_LIMIT = 6_000;
const RAG_REFERENCE_CONTENT_CHAR_LIMIT = 2_500;
const RAG_REFERENCES_TOTAL_CHAR_LIMIT = 12_000;

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 72)).trimEnd()}\n[Content truncated to keep section generation focused.]`;
}

function buildSystemMessage(
  docLocale: DocumentLanguage = "en",
  options: { needsDiagram?: boolean; isParentSection?: boolean } = {},
): ChatMessage {
  return { role: "system", content: buildWritingContext(docLocale, options) };
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

  const entries: string[] = [];
  let used = 0;
  for (const section of completed) {
    const header = `### ${section.title}\n`;
    const remaining = COMPLETED_SUMMARIES_TOTAL_CHAR_LIMIT - used - header.length;
    if (remaining <= 0) break;
    const entry = `${header}${truncateText(section.summary || "", remaining)}`;
    entries.push(entry);
    used += entry.length;
  }

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

  const entries: string[] = [];
  let used = 0;
  for (const [index, ref] of sorted.entries()) {
    const docId = ref.documentId;
    const rewrittenContent = docId
      ? ref.content.replace(
          /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
          (_, alt, filename) => `![${alt}](/api/v1/documents/${docId}/images/${filename})`
        )
      : ref.content;
    const header = `### Reference ${index + 1} [Source: ${ref.documentName}, Relevance: ${(ref.score * 100).toFixed(0)}%]\n`;
    const remaining = RAG_REFERENCES_TOTAL_CHAR_LIMIT - used - header.length;
    if (remaining <= 0) break;
    const contentLimit = Math.min(RAG_REFERENCE_CONTENT_CHAR_LIMIT, remaining);
    const entry = `${header}${truncateText(rewrittenContent, contentLimit)}`;
    entries.push(entry);
    used += entry.length;
  }

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
  constraints: NonNullable<ContextInput["constraints"]>,
  docLocale: DocumentLanguage,
): string {
  const parts: string[] = [
    docLocale === "zh-CN"
      ? "## \u672c\u7ae0\u8282\u5f3a\u5236\u8981\u6c42"
      : "## Mandatory Section-Specific Requirements",
  ];

  if (constraints.referenceSections && constraints.referenceSections.length > 0) {
    parts.push(
      `Prioritize these reference sections: ${constraints.referenceSections.join(", ")}`
    );
  }

  if (constraints.additionalRequirements) {
    parts.push(
      docLocale === "zh-CN"
        ? `\u4ee5\u4e0b\u8981\u6c42\u7531\u7528\u6237\u9488\u5bf9\u5f53\u524d\u7ae0\u8282\u63d0\u4f9b\uff0c\u5fc5\u987b\u9075\u5b88\uff1a\n${constraints.additionalRequirements}`
        : `The following requirements are user-provided and must be followed for this section:\n${constraints.additionalRequirements}`
    );
  }

  return parts.join("\n");
}

export function assembleContext(input: ContextInput, docLocale: DocumentLanguage = "en"): ChatMessage[] {
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
    userParts.push(buildConstraintsBlock(input.constraints, docLocale));
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

  const needsDiagram = sectionNeedsDiagram(input.section, input.constraints);

  if (needsDiagram) {
    userParts.push("");
    userParts.push(
      docLocale === "zh-CN"
        ? "\u5f53\u524d\u7ae0\u8282\u9700\u8981\u56fe\u8868\u3002\u8bf7\u5728\u6700\u80fd\u8bf4\u660e\u67b6\u6784\u3001\u6d41\u7a0b\u3001\u62d3\u6251\u6216\u65f6\u5e8f\u7684\u6bb5\u843d\u540e\uff0c\u51c6\u786e\u63d2\u5165\u4e00\u4e2a [DIAGRAM_REQUEST:...] \u5757\u3002\u5fc5\u987b\u4f7f\u7528\u7cfb\u7edf\u63d0\u793a\u4e2d\u5b9a\u4e49\u7684\u8bed\u6cd5\u3002"
        : "This section requires a diagram. Include exactly one [DIAGRAM_REQUEST:...] block after the paragraph that best describes the architecture, flow, topology, or sequence. Use the syntax documented in the system prompt."
    );
  }

  return [
    buildSystemMessage(docLocale, { needsDiagram, isParentSection: isParent }),
    { role: "user", content: userParts.join("\n") },
  ];
}
