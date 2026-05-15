export interface DiagramRequest {
  type: string;
  title: string;
  purpose: string;
  placement: string;
  nodes?: string;
  flows?: string;
  raw: string;
}

const DIAGRAM_BLOCK_RE = /\[DIAGRAM_REQUEST:\s*([\s\S]*?)\]/g;
const FIELD_RE = /^(\w+)=(.*)$/;

export function parseDiagramRequests(content: string): {
  diagrams: DiagramRequest[];
  cleaned: string;
} {
  const diagrams: DiagramRequest[] = [];
  let match: RegExpExecArray | null;

  DIAGRAM_BLOCK_RE.lastIndex = 0;
  while ((match = DIAGRAM_BLOCK_RE.exec(content)) !== null) {
    const body = match[1];
    const fields: Record<string, string> = {};

    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const fm = FIELD_RE.exec(trimmed);
      if (fm) {
        fields[fm[1]] = fm[2];
      }
    }

    diagrams.push({
      type: fields.type || "unknown",
      title: fields.title || "Untitled Diagram",
      purpose: fields.purpose || "",
      placement: fields.placement || "after_current_paragraph",
      nodes: fields.nodes,
      flows: fields.flows,
      raw: match[0],
    });
  }

  const cleaned = content.replace(DIAGRAM_BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trim();

  return { diagrams, cleaned };
}

export type ContentSegment =
  | { kind: "text"; content: string }
  | { kind: "diagram"; diagram: DiagramRequest };

export function segmentContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  DIAGRAM_BLOCK_RE.lastIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DIAGRAM_BLOCK_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) {
        segments.push({ kind: "text", content: text });
      }
    }

    const body = match[1];
    const fields: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const fm = FIELD_RE.exec(trimmed);
      if (fm) {
        fields[fm[1]] = fm[2];
      }
    }

    segments.push({
      kind: "diagram",
      diagram: {
        type: fields.type || "unknown",
        title: fields.title || "Untitled Diagram",
        purpose: fields.purpose || "",
        placement: fields.placement || "after_current_paragraph",
        nodes: fields.nodes,
        flows: fields.flows,
        raw: match[0],
      },
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) {
      segments.push({ kind: "text", content: text });
    }
  }

  return segments;
}

const TYPE_LABELS: Record<string, string> = {
  architecture: "Architecture",
  flowchart: "Flowchart",
  "data-flow": "Data Flow",
  deployment: "Deployment",
  component: "Component",
  sequence: "Sequence",
  comparison: "Comparison",
  timeline: "Timeline",
  security: "Security",
};

export function diagramTypeLabel(type: string): string {
  return TYPE_LABELS[type] || type;
}
