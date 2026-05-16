export type NodeShape =
  | "rect"
  | "double_rect"
  | "cylinder"
  | "hexagon"
  | "diamond"
  | "circle"
  | "document"
  | "folder"
  | "terminal"
  | "speech"
  | "user_avatar"
  | "bot"
  | "icon_box"
  | "dashed_container";

export type ArrowFlow =
  | "control"
  | "read"
  | "write"
  | "data"
  | "async"
  | "feedback"
  | "neutral";

export type DiagramStyle =
  | "flat-icon"
  | "dark-terminal"
  | "blueprint"
  | "notion-clean"
  | "glassmorphism"
  | "claude"
  | "openai";

export type DiagramType =
  | "architecture"
  | "data-flow"
  | "flowchart"
  | "sequence"
  | "agent"
  | "memory"
  | "comparison"
  | "timeline"
  | "mind-map"
  | "class"
  | "use-case"
  | "state-machine"
  | "er-diagram"
  | "network-topology";

export interface DiagramNode {
  id: string;
  label: string;
  row?: number;
  col?: number;
  shape?: NodeShape;
  typeLabel?: string;
  sublabel?: string;
  tags?: { label: string; fill?: string; stroke?: string; textFill?: string }[];
}

export interface DiagramArrow {
  from: string;
  to: string;
  label?: string;
  flow?: ArrowFlow;
  dashed?: boolean;
}

export interface DiagramContainer {
  id: string;
  label: string;
  subtitle?: string;
  sideLabel?: string;
  nodeIds: string[];
}

export interface DiagramLegend {
  flow: ArrowFlow;
  label: string;
}

export interface DiagramSpec {
  type: DiagramType;
  title: string;
  subtitle?: string;
  purpose?: string;
  style: DiagramStyle;
  nodes: DiagramNode[];
  arrows: DiagramArrow[];
  containers: DiagramContainer[];
  legend: DiagramLegend[];
  footer?: string;
  placement: {
    position: "after_paragraph" | "before_heading" | "end_of_section";
  };
}

const SHAPE_HINTS: Record<string, NodeShape> = {
  database: "cylinder",
  db: "cylinder",
  cache: "cylinder",
  storage: "cylinder",
  store: "cylinder",
  "vector store": "cylinder",
  "vector db": "cylinder",
  "graph db": "cylinder",
  redis: "cylinder",
  postgres: "cylinder",
  mysql: "cylinder",
  mongo: "cylinder",
  pinecone: "cylinder",
  agent: "hexagon",
  orchestrator: "hexagon",
  llm: "double_rect",
  model: "double_rect",
  gpt: "double_rect",
  claude: "double_rect",
  api: "double_rect",
  gateway: "double_rect",
  service: "double_rect",
  microservice: "double_rect",
  group: "dashed_container",
  cluster: "dashed_container",
  layer: "dashed_container",
  zone: "dashed_container",
  module: "dashed_container",
  user: "user_avatar",
  client: "user_avatar",
  customer: "user_avatar",
  human: "user_avatar",
  bot: "bot",
  chatbot: "bot",
  assistant: "bot",
  document: "document",
  file: "document",
  config: "document",
  report: "document",
  folder: "folder",
  directory: "folder",
  workspace: "folder",
  terminal: "terminal",
  console: "terminal",
  cli: "terminal",
  browser: "terminal",
  speech: "speech",
  message: "speech",
  notification: "speech",
  alert: "speech",
};

function inferShape(label: string): NodeShape | undefined {
  const lower = label.toLowerCase();
  for (const [keyword, shape] of Object.entries(SHAPE_HINTS)) {
    if (lower.includes(keyword)) return shape;
  }
  return undefined;
}

export function buildSpecFromStructuredJson(json: {
  type?: string;
  title?: string;
  subtitle?: string;
  style?: string;
  nodes?: { id: string; label: string; shape?: string; typeLabel?: string; sublabel?: string; tags?: { label: string; fill?: string; stroke?: string; textFill?: string }[] }[];
  arrows?: { from: string; to: string; label?: string; flow?: string; dashed?: boolean }[];
  containers?: { id: string; label: string; subtitle?: string; sideLabel?: string; nodeIds: string[] }[];
  legend?: { flow: string; label: string }[];
  footer?: string;
}): DiagramSpec {
  const styleMap: Record<string, DiagramStyle> = {
    "flat-icon": "flat-icon",
    flat: "flat-icon",
    "dark-terminal": "dark-terminal",
    dark: "dark-terminal",
    terminal: "dark-terminal",
    blueprint: "blueprint",
    "notion-clean": "notion-clean",
    notion: "notion-clean",
    glassmorphism: "glassmorphism",
    glass: "glassmorphism",
    claude: "claude",
    openai: "openai",
  };

  const validTypes: Set<string> = new Set<DiagramType>([
    "architecture", "data-flow", "flowchart", "sequence", "agent",
    "memory", "comparison", "timeline", "mind-map", "class",
    "use-case", "state-machine", "er-diagram", "network-topology",
  ]);

  const type = (json.type && validTypes.has(json.type)) ? json.type as DiagramType : "architecture";
  const style = styleMap[json.style || ""] || "flat-icon";

  const nodes: DiagramNode[] = (json.nodes || []).map((n) => ({
    id: n.id,
    label: n.label,
    shape: (n.shape as NodeShape) || inferShape(n.label),
    typeLabel: n.typeLabel,
    sublabel: n.sublabel,
    tags: n.tags,
  }));

  const arrows: DiagramArrow[] = (json.arrows || []).map((a) => ({
    from: a.from,
    to: a.to,
    label: a.label,
    flow: (a.flow as ArrowFlow) || undefined,
    dashed: a.dashed,
  }));

  const containers: DiagramContainer[] = (json.containers || []).map((c) => ({
    id: c.id,
    label: c.label,
    subtitle: c.subtitle,
    sideLabel: c.sideLabel,
    nodeIds: c.nodeIds,
  }));

  const legend: DiagramLegend[] = (json.legend || []).map((l) => ({
    flow: (l.flow as ArrowFlow) || "neutral",
    label: l.label,
  }));

  return {
    type,
    title: json.title || "Untitled Diagram",
    subtitle: json.subtitle,
    style,
    nodes,
    arrows,
    containers,
    legend,
    footer: json.footer,
    placement: { position: "after_paragraph" },
  };
}

export function buildSpecFromRawPrompt(rawPrompt: string): DiagramSpec {
  const fields: Record<string, string> = {};

  for (const line of rawPrompt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      fields[key] = val;
    }
  }

  const nodesRaw = fields.nodes || "";
  const flowsRaw = fields.flows || "";

  const nodeLabels = nodesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const nodes: DiagramNode[] = nodeLabels.map((label) => ({
    id: `n${nodeLabels.indexOf(label)}`,
    label,
    shape: inferShape(label),
  }));

  const labelToId = new Map<string, string>();
  nodeLabels.forEach((label, i) => {
    labelToId.set(label.trim().toLowerCase(), `n${i}`);
  });

  const arrowCandidates = flowsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((flow) => {
      const parts = flow.split("->").map((s) => s.trim());
      if (parts.length < 2) return null as DiagramArrow | null;

      const fromPart = parts[0];
      const toPart = parts[parts.length - 1];
      let label: string | undefined;

      const parenMatch = flow.match(/\(([^)]+)\)\s*$/);
      if (parenMatch) {
        label = parenMatch[1];
      }

      const fromId = labelToId.get(fromPart.toLowerCase()) || fromPart;
      const toId = labelToId.get(toPart.toLowerCase()) || toPart;
      return { from: fromId, to: toId, label };
    });

  const arrows: DiagramArrow[] = arrowCandidates.filter((a): a is DiagramArrow => a !== null);

  const diagramType = fields.type || "architecture";

  const styleMap: Record<string, DiagramStyle> = {
    blueprint: "blueprint",
    notion: "notion-clean",
    claude: "claude",
    openai: "openai",
    "flat-icon": "flat-icon",
    flat: "flat-icon",
    dark: "dark-terminal",
    terminal: "dark-terminal",
    glass: "glassmorphism",
    glassmorphism: "glassmorphism",
  };

  return {
    type: diagramType as DiagramType,
    title: fields.title || "Untitled Diagram",
    subtitle: fields.subtitle,
    purpose: fields.purpose || "",
    style: styleMap[fields.style] || "flat-icon",
    nodes,
    arrows,
    containers: [],
    legend: [],
    footer: fields.footer,
    placement: {
      position: (fields.placement as DiagramSpec["placement"]["position"]) || "after_paragraph",
    },
  };
}
