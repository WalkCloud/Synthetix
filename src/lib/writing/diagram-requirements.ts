import { parseDiagramRequests } from "@/lib/writing/diagram";
import type { ContextInput } from "@/lib/writing/context";

type SectionLike = ContextInput["section"];
type ConstraintsLike = ContextInput["constraints"];

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
  "resource pool",
  "resource pools",
  "physical isolation",
  "silo",
  "siloed",
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
  "\u67b6\u6784",
  "\u7cfb\u7edf\u67b6\u6784",
  "\u603b\u4f53\u67b6\u6784",
  "\u6280\u672f\u67b6\u6784",
  "\u90e8\u7f72\u67b6\u6784",
  "\u5e94\u7528\u67b6\u6784",
  "\u6570\u636e\u67b6\u6784",
  "\u62d3\u6251",
  "\u7f51\u7edc\u62d3\u6251",
  "\u90e8\u7f72\u62d3\u6251",
  "\u8d44\u6e90\u6c60",
  "\u7269\u7406\u9694\u79bb",
  "\u8d44\u6e90\u5b64\u5c9b",
  "\u70df\u56f1\u5f0f",
  "\u4fe1\u521b",
  "\u6d41\u7a0b",
  "\u4e1a\u52a1\u6d41\u7a0b",
  "\u5904\u7406\u6d41\u7a0b",
  "\u6570\u636e\u6d41",
  "\u65f6\u5e8f",
  "\u8c03\u7528\u94fe\u8def",
  "\u7ec4\u4ef6",
  "\u6a21\u5757\u5173\u7cfb",
  "\u96c6\u7fa4",
  "\u9ad8\u53ef\u7528",
  "\u5bb9\u707e",
  "\u5fae\u670d\u52a1",
  "\u591a\u79df\u6237",
  "\u7ba1\u9053",
  "\u6d41\u6c34\u7ebf",
  "\u5de5\u5177\u94fe",
  "\u8def\u7ebf\u56fe",
  "\u9636\u6bb5\u8ba1\u5212",
];

const EXPLICIT_DIAGRAM_PATTERNS = [
  /include\s+(an?\s+)?(architecture\s+)?diagram/i,
  /include\s+(a\s+)?flowchart/i,
  /diagram\s+required/i,
  /\u9700\u8981.*\u56fe/,
  /\u5305\u542b.*\u56fe/,
  /\u753b\u56fe/,
  /\u67b6\u6784\u56fe/,
  /\u6d41\u7a0b\u56fe/,
  /\u62d3\u6251\u56fe/,
  /\u65f6\u5e8f\u56fe/,
  /\u7ec4\u4ef6\u56fe/,
  /\u6570\u636e\u6d41\u56fe/,
];

function textForDiagramDetection(section: SectionLike, constraints?: ConstraintsLike): string {
  return [
    section.title,
    section.description,
    section.keyPoints,
    constraints?.additionalRequirements,
    constraints?.writingRequirements,
    constraints?.retrievalQuery,
    constraints?.referenceHints?.join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function sectionNeedsDiagram(section: SectionLike, constraints?: ConstraintsLike): boolean {
  const text = textForDiagramDetection(section, constraints);
  if (EXPLICIT_DIAGRAM_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return DIAGRAM_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
}

function inferDiagramType(text: string): string {
  if (/sequence/i.test(text) || text.includes("\u65f6\u5e8f") || text.includes("\u8c03\u7528\u94fe\u8def")) {
    return "sequence";
  }
  if (/data\s+flow/i.test(text) || text.includes("\u6570\u636e\u6d41")) {
    return "data-flow";
  }
  if (/flowchart|flow\s+diagram/i.test(text) || text.includes("\u6d41\u7a0b")) {
    return "flowchart";
  }
  if (
    /topology|deployment|resource\s+pools?|physical\s+isolation|siloed?/i.test(text) ||
    text.includes("\u62d3\u6251") ||
    text.includes("\u90e8\u7f72") ||
    text.includes("\u8d44\u6e90\u6c60") ||
    text.includes("\u7269\u7406\u9694\u79bb") ||
    text.includes("\u8d44\u6e90\u5b64\u5c9b") ||
    text.includes("\u70df\u56f1\u5f0f") ||
    text.includes("\u4fe1\u521b")
  ) {
    return "deployment";
  }
  if (/timeline|roadmap|milestone/i.test(text) || text.includes("\u8def\u7ebf\u56fe") || text.includes("\u9636\u6bb5")) {
    return "timeline";
  }
  return "architecture";
}

function isTopologyDiagramType(type: string): boolean {
  return type === "architecture" || type === "deployment" || type === "component" || type === "security";
}

function compact(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

export function ensureRequiredDiagramRequest(
  content: string,
  section: SectionLike,
  constraints?: ConstraintsLike,
): string {
  if (!sectionNeedsDiagram(section, constraints)) return content;
  if (parseDiagramRequests(content).diagrams.length > 0) return content;

  const text = textForDiagramDetection(section, constraints);
  const type = inferDiagramType(text);
  const title = `${compact(section.title, "Section")} diagram`;
  const purpose = compact(
    section.description || constraints?.additionalRequirements || constraints?.writingRequirements,
    `Show the structure and relationships for ${compact(section.title, "this section")}`,
  );
  const nodes = compact(section.keyPoints, section.title || "main components");

  return [
    content.trimEnd(),
    "",
    "[DIAGRAM_REQUEST:",
    `type=${type}`,
    `title=${title}`,
    `purpose=${purpose}`,
    "placement=after_current_paragraph",
    `nodes=${nodes}`,
    ...(isTopologyDiagramType(type)
      ? ["relationships=derive topology, ownership, management scope, and isolation boundaries from the section content"]
      : ["flows=derive from the section content"]),
    "]",
  ].join("\n");
}
