export interface DiagramRequest {
  type: string;
  title: string;
  purpose: string;
  placement: string;
  nodes?: string;
  flows?: string;
  raw: string;
}

export interface ImageRequest {
  prompt: string;
  title: string;
  raw: string;
}

const DIAGRAM_BLOCK_RE = /\[DIAGRAM_REQUEST:\s*([\s\S]*?)\]/g;
const IMAGE_BLOCK_RE = /\[IMAGE_REQUEST:\s*([\s\S]*?)\]/g;
const FIELD_RE = /^(\w+)=(.*)$/;

export function parseDiagramRequests(content: string): {
  diagrams: DiagramRequest[];
  images: ImageRequest[];
  cleaned: string;
} {
  const diagrams: DiagramRequest[] = [];
  const images: ImageRequest[] = [];
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

  IMAGE_BLOCK_RE.lastIndex = 0;
  while ((match = IMAGE_BLOCK_RE.exec(content)) !== null) {
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

    images.push({
      prompt: fields.prompt || fields.description || "",
      title: fields.title || "Illustration",
      raw: match[0],
    });
  }

  let cleaned = content.replace(DIAGRAM_BLOCK_RE, "").replace(IMAGE_BLOCK_RE, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return { diagrams, images, cleaned };
}

export type ContentSegment =
  | { kind: "text"; content: string }
  | { kind: "diagram_asset"; content: string; assetId: string; title?: string; markerId?: string; markerParams?: Record<string, string> }
  | { kind: "image_asset"; content: string; assetId: string; title?: string; markerId?: string; markerParams?: Record<string, string> }
  | { kind: "diagram_request"; content: string; marker: DiagramRequest & { markerId?: string } }
  | { kind: "image_request"; content: string; marker: ImageRequest & { markerId?: string } };

const ALL_BLOCK_RE = /\[(DIAGRAM_REQUEST|IMAGE_REQUEST|DIAGRAM|IMAGE):\s*([\s\S]*?)\]/g;

function parseAssetBody(body: string): {
  assetId: string;
  markerId?: string;
  markerParams?: Record<string, string>;
  title?: string;
} {
  const parts = body.split("|");
  const assetId = parts[0].trim();
  if (parts.length < 2) return { assetId };

  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf("=");
    if (eqIdx > 0) {
      const key = parts[i].slice(0, eqIdx).trim();
      const val = parts[i].slice(eqIdx + 1).trim();
      params[key] = val;
    }
  }

  return {
    assetId,
    markerId: params.id,
    markerParams: Object.keys(params).length > 0 ? params : undefined,
    title: params.title,
  };
}

export function segmentContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  ALL_BLOCK_RE.lastIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ALL_BLOCK_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) {
        segments.push({ kind: "text", content: text });
      }
    }

    const blockType = match[1];
    const body = match[2];
    const fields: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const fm = FIELD_RE.exec(trimmed);
      if (fm) {
        fields[fm[1]] = fm[2];
      }
    }

    if (blockType === "DIAGRAM") {
      const { assetId, markerId, markerParams, title } = parseAssetBody(body.trim());
      segments.push({
        kind: "diagram_asset",
        content: match[0],
        assetId,
        title,
        markerId,
        markerParams,
      });
    } else if (blockType === "IMAGE") {
      const { assetId, markerId, markerParams, title } = parseAssetBody(body.trim());
      segments.push({
        kind: "image_asset",
        content: match[0],
        assetId,
        title,
        markerId,
        markerParams,
      });
    } else if (blockType === "IMAGE_REQUEST") {
      segments.push({
        kind: "image_request",
        content: match[0],
        marker: {
          prompt: fields.prompt || fields.description || "",
          title: fields.title || "Illustration",
          raw: match[0],
          markerId: fields.id,
        },
      });
    } else {
      segments.push({
        kind: "diagram_request",
        content: match[0],
        marker: {
          type: fields.type || "unknown",
          title: fields.title || "Untitled Diagram",
          purpose: fields.purpose || "",
          placement: fields.placement || "after_current_paragraph",
          nodes: fields.nodes,
          flows: fields.flows,
          raw: match[0],
          markerId: fields.id,
        },
      });
    }

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
