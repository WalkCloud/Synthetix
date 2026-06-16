function generateMarkerId(): string {
  return Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
}

export interface ParsedImageMarker {
  kind: "image";
  raw: string;
  markerId: string;
  startIndex: number;
  endIndex: number;
  params: {
    type: string;
    title: string;
    prompt: string;
    size?: string;
    style?: string;
  };
}

export interface ParsedDiagramMarker {
  kind: "diagram";
  raw: string;
  markerId: string;
  startIndex: number;
  endIndex: number;
  params: {
    type: string;
    title: string;
    purpose?: string;
    nodes?: string;
    flows?: string;
    style?: string;
  };
}

export type ParsedMarker = ParsedImageMarker | ParsedDiagramMarker;

const FIELD_RE = /^(\w+)=(.*)$/;

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fm = FIELD_RE.exec(trimmed);
    if (fm) {
      fields[fm[1]] = fm[2];
    }
  }
  return fields;
}

const ALL_MARKER_RE = /\[(IMAGE_REQUEST|DIAGRAM_REQUEST|IMAGE|DIAGRAM):\s*([\s\S]*?)\]/g;

function parseAssetFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const parts = body.split("|");
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf("=");
    if (eqIdx > 0) {
      fields[parts[i].slice(0, eqIdx).trim()] = parts[i].slice(eqIdx + 1).trim();
    }
  }
  return fields;
}

export function parseAllMarkers(content: string): ParsedMarker[] {
  const markers: ParsedMarker[] = [];
  ALL_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ALL_MARKER_RE.exec(content)) !== null) {
    const blockType = match[1];
    const body = match[2];

    if (blockType === "IMAGE" || blockType === "DIAGRAM") {
      const fields = parseAssetFields(body.trim());
      const markerId = fields.id;
      if (!markerId) continue;

      if (blockType === "IMAGE") {
        markers.push({
          kind: "image",
          raw: match[0],
          markerId,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          params: {
            type: fields.type || "illustration",
            title: fields.title || "Illustration",
            prompt: fields.prompt || fields.description || "",
            size: fields.size,
            style: fields.style,
          },
        });
      } else {
        markers.push({
          kind: "diagram",
          raw: match[0],
          markerId,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          params: {
            type: fields.type || "architecture",
            title: fields.title || "Untitled Diagram",
            purpose: fields.purpose,
            nodes: fields.nodes,
            flows: fields.flows,
            style: fields.style,
          },
        });
      }
      continue;
    }

    const fields = parseFields(body);
    const markerId = fields.id || generateMarkerId();

    if (blockType === "IMAGE_REQUEST") {
      markers.push({
        kind: "image",
        raw: match[0],
        markerId,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        params: {
          type: fields.type || "illustration",
          title: fields.title || "Illustration",
          prompt: fields.prompt || fields.description || "",
          size: fields.size,
          style: fields.style,
        },
      });
    } else {
      markers.push({
        kind: "diagram",
        raw: match[0],
        markerId,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        params: {
          type: fields.type || "architecture",
          title: fields.title || "Untitled Diagram",
          purpose: fields.purpose,
          nodes: fields.nodes,
          flows: fields.flows,
          style: fields.style,
        },
      });
    }
  }

  return markers;
}

const REQUEST_MARKER_RE = /\[(IMAGE_REQUEST|DIAGRAM_REQUEST):\s*([\s\S]*?)\]/g;

export function injectMarkerIds(content: string): string {
  REQUEST_MARKER_RE.lastIndex = 0;
  return content.replace(REQUEST_MARKER_RE, (match, blockType: string, body: string) => {
    const fields = parseFields(body);
    if (fields.id) return match;
    const id = generateMarkerId();
    const idField = `id=${id}`;
    const firstNewline = body.indexOf("\n");
    if (firstNewline >= 0) {
      return `[${blockType}: ${idField}\n${body.slice(firstNewline + 1)}]`;
    }
    return `[${blockType}: ${idField} ${body.trim()}]`;
  });
}

function findMarkerById(content: string, markerId: string): ParsedMarker | null {
  const markers = parseAllMarkers(content);
  return markers.find((m) => m.markerId === markerId) || null;
}
