import type {
  DiagramSpec,
  DiagramNode,
  DiagramArrow,
  DiagramContainer,
  DiagramLegend,
  NodeShape,
  ArrowFlow,
  DiagramStyle,
} from "./diagram-spec";
import type { ComponentType } from "./diagram-spec";
import { PRODUCT_ICONS } from "./diagram-icons";

const COMPONENT_COLORS: Record<string, Record<string, { fill: string; stroke: string }>> = {
  "flat-icon": {
    frontend:  { fill: "rgba(8,51,68,0.4)",   stroke: "#22d3ee" },
    backend:   { fill: "rgba(6,78,59,0.4)",   stroke: "#34d399" },
    database:  { fill: "rgba(76,29,149,0.4)", stroke: "#a78bfa" },
    cloud:     { fill: "rgba(120,53,15,0.3)", stroke: "#fbbf24" },
    security:  { fill: "rgba(136,19,55,0.4)", stroke: "#fb7185" },
    messaging: { fill: "rgba(251,146,60,0.3)",stroke: "#fb923c" },
    external:  { fill: "rgba(30,41,59,0.5)",  stroke: "#94a3b8" },
  },
  "dark-terminal": {
    frontend:  { fill: "#0f172a", stroke: "#38bdf8" },
    backend:   { fill: "#0f172a", stroke: "#22c55e" },
    database:  { fill: "#0f172a", stroke: "#a855f7" },
    cloud:     { fill: "#0f172a", stroke: "#fbbf24" },
    security:  { fill: "#0f172a", stroke: "#fb7185" },
    messaging: { fill: "#0f172a", stroke: "#fb923c" },
    external:  { fill: "#0f172a", stroke: "#94a3b8" },
  },
  blueprint: {
    frontend:  { fill: "#0b3b5e", stroke: "#67e8f9" },
    backend:   { fill: "#0b3b5e", stroke: "#6ee7b7" },
    database:  { fill: "#0b3b5e", stroke: "#c4b5fd" },
    cloud:     { fill: "#0b3b5e", stroke: "#fde68a" },
    security:  { fill: "#0b3b5e", stroke: "#fda4af" },
    messaging: { fill: "#0b3b5e", stroke: "#fdba74" },
    external:  { fill: "#0b3b5e", stroke: "#cbd5e1" },
  },
  "notion-clean": {
    frontend:  { fill: "#eff6ff", stroke: "#3b82f6" },
    backend:   { fill: "#f0fdf4", stroke: "#22c55e" },
    database:  { fill: "#faf5ff", stroke: "#a855f7" },
    cloud:     { fill: "#fffbeb", stroke: "#f59e0b" },
    security:  { fill: "#fff1f2", stroke: "#f43f5e" },
    messaging: { fill: "#fff7ed", stroke: "#f97316" },
    external:  { fill: "#f8fafc", stroke: "#64748b" },
  },
  glassmorphism: {
    frontend:  { fill: "rgba(59,130,246,0.12)", stroke: "#60a5fa" },
    backend:   { fill: "rgba(34,197,94,0.12)",  stroke: "#4ade80" },
    database:  { fill: "rgba(168,85,247,0.12)", stroke: "#c084fc" },
    cloud:     { fill: "rgba(245,158,11,0.12)", stroke: "#fbbf24" },
    security:  { fill: "rgba(244,63,94,0.12)",  stroke: "#fb7185" },
    messaging: { fill: "rgba(249,115,22,0.12)", stroke: "#fb923c" },
    external:  { fill: "rgba(100,116,139,0.12)",stroke: "#94a3b8" },
  },
  claude: {
    frontend:  { fill: "#faf5f0", stroke: "#d97757" },
    backend:   { fill: "#f0faf5", stroke: "#6b9f78" },
    database:  { fill: "#f5f0fa", stroke: "#8b7ba8" },
    cloud:     { fill: "#faf8f0", stroke: "#c4a84f" },
    security:  { fill: "#faf0f0", stroke: "#c47070" },
    messaging: { fill: "#faf5f0", stroke: "#c49f6b" },
    external:  { fill: "#f5f5f5", stroke: "#8b8b8b" },
  },
  openai: {
    frontend:  { fill: "#f0f7f0", stroke: "#10a37f" },
    backend:   { fill: "#f0f0f7", stroke: "#6b7fa8" },
    database:  { fill: "#f7f0f7", stroke: "#a87bb0" },
    cloud:     { fill: "#f7f7f0", stroke: "#c4a84f" },
    security:  { fill: "#f7f0f0", stroke: "#c47070" },
    messaging: { fill: "#f7f5f0", stroke: "#c49f6b" },
    external:  { fill: "#f5f5f5", stroke: "#8b8b8b" },
  },
};

function isTransparent(fill: string): boolean {
  const match = fill.match(/rgba\([^)]+,([\d.]+)\)/);
  return !!match && parseFloat(match[1]) < 1;
}

const CJK_FONT = "'Helvetica Neue', Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', 'Microsoft JhengHei', 'SimHei', sans-serif";
const MONO_FONT = "'SF Mono', 'Fira Code', Menlo, 'Courier New', monospace";

interface StyleProfile {
  name: string;
  fontFamily: string;
  background: string;
  backgroundExtra?: string;
  titleAlign: "left" | "center";
  titleFill: string;
  titleSize: number;
  subtitleFill: string;
  subtitleSize: number;
  titleDivider: boolean;
  nodeFill: string;
  nodeStroke: string;
  nodeRadius: number;
  nodeShadow: string;
  nodeStrokeWidth: number;
  arrowWidth: number;
  arrowColors: Record<ArrowFlow, string>;
  arrowDash: Partial<Record<ArrowFlow, string>>;
  arrowLabelBg: string;
  arrowLabelOpacity: number;
  arrowLabelFill: string;
  typeLabelFill: string;
  typeLabelSize: number;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  sectionFill: string;
  sectionStroke: string;
  sectionDash: string;
  sectionLabelFill: string;
  sectionSubFill: string;
  sectionUpper: boolean;
  legendFill: string;
}

const STYLES: Record<DiagramStyle, StyleProfile> = {
  "flat-icon": {
    name: "Flat Icon",
    fontFamily: CJK_FONT,
    background: "#ffffff",
    titleAlign: "center",
    titleFill: "#111827",
    titleSize: 22,
    subtitleFill: "#6b7280",
    subtitleSize: 13,
    titleDivider: false,
    nodeFill: "#ffffff",
    nodeStroke: "#d1d5db",
    nodeRadius: 10,
    nodeShadow: "url(#shadowSoft)",
    nodeStrokeWidth: 1.8,
    arrowWidth: 2.2,
    arrowColors: {
      control: "#7c3aed",
      write: "#10b981",
      read: "#2563eb",
      data: "#f97316",
      async: "#7c3aed",
      feedback: "#ef4444",
      neutral: "#6b7280",
    },
    arrowDash: { write: "5,3", async: "4,2" },
    arrowLabelBg: "#ffffff",
    arrowLabelOpacity: 0.94,
    arrowLabelFill: "#6b7280",
    typeLabelFill: "#9ca3af",
    typeLabelSize: 11,
    textPrimary: "#111827",
    textSecondary: "#6b7280",
    textMuted: "#94a3b8",
    sectionFill: "none",
    sectionStroke: "#dbe5f1",
    sectionDash: "6 5",
    sectionLabelFill: "#2563eb",
    sectionSubFill: "#94a3b8",
    sectionUpper: true,
    legendFill: "#6b7280",
  },
  "dark-terminal": {
    name: "Dark Terminal",
    fontFamily: MONO_FONT,
    background: "#0f172a",
    backgroundExtra: "terminalGradient",
    titleAlign: "center",
    titleFill: "#e2e8f0",
    titleSize: 22,
    subtitleFill: "#94a3b8",
    subtitleSize: 13,
    titleDivider: false,
    nodeFill: "#1e293b",
    nodeStroke: "#334155",
    nodeRadius: 10,
    nodeShadow: "",
    nodeStrokeWidth: 1.8,
    arrowWidth: 2.2,
    arrowColors: {
      control: "#a855f7",
      write: "#22c55e",
      read: "#38bdf8",
      data: "#fb7185",
      async: "#f59e0b",
      feedback: "#f97316",
      neutral: "#94a3b8",
    },
    arrowDash: { write: "5,3", async: "4,2" },
    arrowLabelBg: "#0f172a",
    arrowLabelOpacity: 0.92,
    arrowLabelFill: "#cbd5e1",
    typeLabelFill: "#64748b",
    typeLabelSize: 11,
    textPrimary: "#e2e8f0",
    textSecondary: "#94a3b8",
    textMuted: "#64748b",
    sectionFill: "rgba(30,41,59,0.5)",
    sectionStroke: "#334155",
    sectionDash: "7 6",
    sectionLabelFill: "#38bdf8",
    sectionSubFill: "#64748b",
    sectionUpper: true,
    legendFill: "#94a3b8",
  },
  blueprint: {
    name: "Blueprint",
    fontFamily: MONO_FONT,
    background: "#082f49",
    backgroundExtra: "blueprintGrid",
    titleAlign: "center",
    titleFill: "#e0f2fe",
    titleSize: 22,
    subtitleFill: "#7dd3fc",
    subtitleSize: 13,
    titleDivider: false,
    nodeFill: "#0b3b5e",
    nodeStroke: "#67e8f9",
    nodeRadius: 8,
    nodeShadow: "",
    nodeStrokeWidth: 1.6,
    arrowWidth: 2.0,
    arrowColors: {
      control: "#67e8f9",
      write: "#22d3ee",
      read: "#38bdf8",
      data: "#fde047",
      async: "#c084fc",
      feedback: "#fb7185",
      neutral: "#bae6fd",
    },
    arrowDash: { write: "5,3", async: "4,2" },
    arrowLabelBg: "#082f49",
    arrowLabelOpacity: 0.9,
    arrowLabelFill: "#e0f2fe",
    typeLabelFill: "#7dd3fc",
    typeLabelSize: 11,
    textPrimary: "#e0f2fe",
    textSecondary: "#bae6fd",
    textMuted: "#7dd3fc",
    sectionFill: "none",
    sectionStroke: "#0ea5e9",
    sectionDash: "6 4",
    sectionLabelFill: "#67e8f9",
    sectionSubFill: "#7dd3fc",
    sectionUpper: true,
    legendFill: "#bae6fd",
  },
  "notion-clean": {
    name: "Notion Clean",
    fontFamily: CJK_FONT,
    background: "#ffffff",
    titleAlign: "left",
    titleFill: "#111827",
    titleSize: 18,
    subtitleFill: "#9ca3af",
    subtitleSize: 12,
    titleDivider: true,
    nodeFill: "#f9fafb",
    nodeStroke: "#e5e7eb",
    nodeRadius: 4,
    nodeShadow: "",
    nodeStrokeWidth: 1.4,
    arrowWidth: 1.8,
    arrowColors: {
      control: "#3b82f6",
      write: "#3b82f6",
      read: "#3b82f6",
      data: "#3b82f6",
      async: "#9ca3af",
      feedback: "#9ca3af",
      neutral: "#d1d5db",
    },
    arrowDash: { write: "5,3", async: "4,2" },
    arrowLabelBg: "#ffffff",
    arrowLabelOpacity: 0.96,
    arrowLabelFill: "#6b7280",
    typeLabelFill: "#9ca3af",
    typeLabelSize: 11,
    textPrimary: "#111827",
    textSecondary: "#374151",
    textMuted: "#9ca3af",
    sectionFill: "none",
    sectionStroke: "#e5e7eb",
    sectionDash: "",
    sectionLabelFill: "#9ca3af",
    sectionSubFill: "#d1d5db",
    sectionUpper: false,
    legendFill: "#6b7280",
  },
  glassmorphism: {
    name: "Glassmorphism",
    fontFamily: CJK_FONT,
    background: "#0f172a",
    backgroundExtra: "glassGradient",
    titleAlign: "center",
    titleFill: "#f8fafc",
    titleSize: 22,
    subtitleFill: "#cbd5e1",
    subtitleSize: 13,
    titleDivider: false,
    nodeFill: "rgba(255,255,255,0.12)",
    nodeStroke: "rgba(255,255,255,0.28)",
    nodeRadius: 18,
    nodeShadow: "url(#shadowGlass)",
    nodeStrokeWidth: 1.4,
    arrowWidth: 2.0,
    arrowColors: {
      control: "#c084fc",
      write: "#34d399",
      read: "#60a5fa",
      data: "#fb923c",
      async: "#f472b6",
      feedback: "#f59e0b",
      neutral: "#cbd5e1",
    },
    arrowDash: { write: "5,3", async: "4,2" },
    arrowLabelBg: "rgba(15,23,42,0.85)",
    arrowLabelOpacity: 1,
    arrowLabelFill: "#e2e8f0",
    typeLabelFill: "#cbd5e1",
    typeLabelSize: 11,
    textPrimary: "#f8fafc",
    textSecondary: "#cbd5e1",
    textMuted: "#94a3b8",
    sectionFill: "rgba(255,255,255,0.05)",
    sectionStroke: "rgba(255,255,255,0.18)",
    sectionDash: "7 6",
    sectionLabelFill: "#e2e8f0",
    sectionSubFill: "#94a3b8",
    sectionUpper: true,
    legendFill: "#cbd5e1",
  },
  claude: {
    name: "Claude Official",
    fontFamily: CJK_FONT,
    background: "#f8f6f3",
    titleAlign: "left",
    titleFill: "#141413",
    titleSize: 20,
    subtitleFill: "#8f8a80",
    subtitleSize: 12,
    titleDivider: true,
    nodeFill: "#fffcf7",
    nodeStroke: "#d9d0c3",
    nodeRadius: 10,
    nodeShadow: "",
    nodeStrokeWidth: 1.6,
    arrowWidth: 1.8,
    arrowColors: {
      control: "#d97757",
      write: "#7b8b5c",
      read: "#8c6f5a",
      data: "#b45309",
      async: "#9a6fb0",
      feedback: "#d97757",
      neutral: "#8f8a80",
    },
    arrowDash: { write: "5,3", async: "4,2" },
    arrowLabelBg: "#f8f6f3",
    arrowLabelOpacity: 0.96,
    arrowLabelFill: "#6b6257",
    typeLabelFill: "#a29a8f",
    typeLabelSize: 11,
    textPrimary: "#141413",
    textSecondary: "#6b6257",
    textMuted: "#a29a8f",
    sectionFill: "none",
    sectionStroke: "#ded8cf",
    sectionDash: "5 4",
    sectionLabelFill: "#8b7355",
    sectionSubFill: "#b4aba0",
    sectionUpper: true,
    legendFill: "#6b6257",
  },
  openai: {
    name: "OpenAI",
    fontFamily: CJK_FONT,
    background: "#ffffff",
    titleAlign: "left",
    titleFill: "#0f172a",
    titleSize: 20,
    subtitleFill: "#64748b",
    subtitleSize: 12,
    titleDivider: true,
    nodeFill: "#ffffff",
    nodeStroke: "#dce5e3",
    nodeRadius: 14,
    nodeShadow: "",
    nodeStrokeWidth: 1.6,
    arrowWidth: 1.8,
    arrowColors: {
      control: "#10a37f",
      write: "#0f766e",
      read: "#0891b2",
      data: "#f59e0b",
      async: "#64748b",
      feedback: "#10a37f",
      neutral: "#94a3b8",
    },
    arrowDash: { write: "5,3", async: "4,2" },
    arrowLabelBg: "#ffffff",
    arrowLabelOpacity: 0.96,
    arrowLabelFill: "#475569",
    typeLabelFill: "#94a3b8",
    typeLabelSize: 11,
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    textMuted: "#94a3b8",
    sectionFill: "none",
    sectionStroke: "#e2e8f0",
    sectionDash: "5 4",
    sectionLabelFill: "#10a37f",
    sectionSubFill: "#94a3b8",
    sectionUpper: true,
    legendFill: "#475569",
  },
};

interface Pos {
  x: number;
  y: number;
}
interface NodeLayout extends Pos {
  w: number;
  h: number;
}
interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const NODE_H = 72;
const MIN_NODE_W = 160;
const MAX_NODE_W = 280;
const CHAR_W = 9;
const CJK_CHAR_W = 15;
const H_GAP = 90;
const V_GAP = 110;
const TITLE_BLOCK_H = 80;
const SECTION_PAD = 24;
const SECTION_HEADER_H = 34;
const SECTION_LABEL_H = 28;
const CONTAINER_GAP = 28;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isCJK(s: string): boolean {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(s);
}

function measureText(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch) ? CJK_CHAR_W : CHAR_W;
  }
  return w;
}

function nodeWidth(label: string): number {
  const est = measureText(label) + 48;
  return Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, est));
}

function nodeBounds(p: NodeLayout): Bounds {
  return { x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 };
}

function topoLayeredLayout(
  nodes: DiagramNode[],
  arrows: DiagramArrow[],
  canvasW: number
): { positions: Map<string, NodeLayout>; maxLayerW: number } {
  const result = new Map<string, NodeLayout>();
  if (nodes.length === 0) return { positions: result, maxLayerW: 0 };

  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  nodes.forEach((n) => {
    adj.set(n.id, []);
    inDeg.set(n.id, 0);
  });
  arrows.forEach((a) => {
    if (adj.has(a.from) && adj.has(a.to)) {
      adj.get(a.from)!.push(a.to);
      inDeg.set(a.to, (inDeg.get(a.to) || 0) + 1);
    }
  });

  const layers: string[][] = [];
  const assigned = new Set<string>();
  let queue = nodes.filter((n) => (inDeg.get(n.id) || 0) === 0).map((n) => n.id);
  if (queue.length === 0) queue = [nodes[0].id];

  while (assigned.size < nodes.length) {
    const layer = queue.filter((id) => !assigned.has(id));
    if (layer.length === 0) {
      nodes.forEach((n) => {
        if (!assigned.has(n.id)) layer.push(n.id);
      });
    }
    layers.push(layer);
    layer.forEach((id) => assigned.add(id));
    const next = new Set<string>();
    layer.forEach((id) => {
      (adj.get(id) || []).forEach((to) => {
        if (!assigned.has(to)) next.add(to);
      });
    });
    if (next.size === 0 && assigned.size < nodes.length) {
      nodes.forEach((n) => {
        if (!assigned.has(n.id)) next.add(n.id);
      });
    }
    queue = [...next];
  }

  let maxLayerW = 0;
  const layerWidths = layers.map((layer) => {
    const w =
      layer.reduce((s, id) => s + nodeWidth(nodes.find((n) => n.id === id)!.label), 0) +
      (layer.length - 1) * H_GAP;
    if (w > maxLayerW) maxLayerW = w;
    return w;
  });

  const totalH = layers.length * (NODE_H + V_GAP);
  const offsetX = Math.max(48, (canvasW - maxLayerW) / 2);

  layers.forEach((layer, li) => {
    const layerW = layerWidths[li];
    const startX = offsetX + (maxLayerW - layerW) / 2;
    let cx = startX;
    layer.forEach((id) => {
      const node = nodes.find((n) => n.id === id)!;
      const w = nodeWidth(node.label);
      result.set(id, {
        x: cx + w / 2,
        y: TITLE_BLOCK_H + li * (NODE_H + V_GAP) + NODE_H / 2,
        w,
        h: NODE_H,
      });
      cx += w + H_GAP;
    });
  });

  return { positions: result, maxLayerW };
}

function layoutWithContainers(
  nodes: DiagramNode[],
  arrows: DiagramArrow[],
  containers: DiagramContainer[],
  canvasW: number
): { positions: Map<string, NodeLayout>; containerBounds: Map<string, Bounds>; maxLayerW: number } {
  const { positions, maxLayerW } = topoLayeredLayout(nodes, arrows, canvasW);
  const containerBounds = new Map<string, Bounds>();

  if (containers.length === 0) {
    return { positions, containerBounds, maxLayerW };
  }

  for (const c of containers) {
    const childPositions: NodeLayout[] = [];
    for (const nid of c.nodeIds) {
      const p = positions.get(nid);
      if (p) childPositions.push(p);
    }
    if (childPositions.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of childPositions) {
      const b = nodeBounds(p);
      minX = Math.min(minX, b.x1);
      minY = Math.min(minY, b.y1);
      maxX = Math.max(maxX, b.x2);
      maxY = Math.max(maxY, b.y2);
    }

    const labelH = c.subtitle ? SECTION_HEADER_H + SECTION_LABEL_H : SECTION_HEADER_H;
    containerBounds.set(c.id, {
      x1: minX - SECTION_PAD,
      y1: minY - SECTION_PAD - labelH,
      x2: maxX + SECTION_PAD,
      y2: maxY + SECTION_PAD,
    });
  }

  return { positions, containerBounds, maxLayerW };
}

function arrowColor(s: StyleProfile, flow?: ArrowFlow): string {
  return s.arrowColors[flow || "neutral"] || s.arrowColors.neutral;
}

function arrowDash(s: StyleProfile, flow?: ArrowFlow, explicitDashed?: boolean): string {
  if (explicitDashed) return "5,3";
  return (flow && s.arrowDash[flow]) || "none";
}

function buildOrthRoute(
  from: NodeLayout,
  to: NodeLayout,
  obstacles: Bounds[],
  allPositions: Map<string, NodeLayout>
): { x: number; y: number }[] {
  const fx = from.x,
    fy = from.y,
    tx = to.x,
    ty = to.y;
  const dx = tx - fx,
    dy = ty - fy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return [];

  let sx: number, sy: number, ex: number, ey: number;
  if (Math.abs(dy) > Math.abs(dx)) {
    sx = fx;
    sy = fy + Math.sign(dy) * (from.h / 2 + 6);
    ex = tx;
    ey = ty - Math.sign(dy) * (to.h / 2 + 6);
  } else {
    sx = fx + Math.sign(dx) * (from.w / 2 + 6);
    sy = fy;
    ex = tx - Math.sign(dx) * (to.w / 2 + 6);
    ey = ty;
  }

  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;

  const laneXs = new Set<number>();
  const laneYs = new Set<number>();
  laneXs.add(sx);
  laneXs.add(ex);
  laneXs.add(mx);
  laneYs.add(sy);
  laneYs.add(ey);
  laneYs.add(my);

  const obsXs = new Set<number>();
  const obsYs = new Set<number>();
  for (const obs of obstacles) {
    obsXs.add(obs.x1 - 12);
    obsXs.add(obs.x2 + 12);
    obsYs.add(obs.y1 - 12);
    obsYs.add(obs.y2 + 12);
  }
  for (const x of obsXs) laneXs.add(x);
  for (const y of obsYs) laneYs.add(y);

  type Pt = { x: number; y: number };
  const candidates: { pts: Pt[]; base: number }[] = [];

  candidates.push({ pts: [{ x: sx, y: sy }, { x: ex, y: sy }, { x: ex, y: ey }], base: Math.abs(ex - sx) + Math.abs(ey - sy) });
  candidates.push({ pts: [{ x: sx, y: sy }, { x: sx, y: ey }, { x: ex, y: ey }], base: Math.abs(ex - sx) + Math.abs(ey - sy) });
  candidates.push({ pts: [{ x: sx, y: sy }, { x: mx, y: sy }, { x: mx, y: ey }, { x: ex, y: ey }], base: Math.abs(mx - sx) + Math.abs(ey - sy) + Math.abs(ex - mx) + 8 });
  candidates.push({ pts: [{ x: sx, y: sy }, { x: sx, y: my }, { x: ex, y: my }, { x: ex, y: ey }], base: Math.abs(ex - sx) + Math.abs(my - sy) + Math.abs(ey - my) + 8 });

  for (const lx of laneXs) {
    if (lx === sx || lx === ex) continue;
    candidates.push({ pts: [{ x: sx, y: sy }, { x: lx, y: sy }, { x: lx, y: ey }, { x: ex, y: ey }], base: Math.abs(lx - sx) + Math.abs(ey - sy) + Math.abs(ex - lx) + 12 });
  }
  for (const ly of laneYs) {
    if (ly === sy || ly === ey) continue;
    candidates.push({ pts: [{ x: sx, y: sy }, { x: sx, y: ly }, { x: ex, y: ly }, { x: ex, y: ey }], base: Math.abs(ex - sx) + Math.abs(ly - sy) + Math.abs(ey - ly) + 12 });
  }

  function countCollisions(pts: Pt[]): number {
    let hits = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      for (const box of obstacles) {
        const eps = 2;
        if (Math.abs(a.y - b.y) < eps) {
          const y = a.y;
          if (box.y1 < y && y < box.y2) {
            const overlapL = Math.max(Math.min(a.x, b.x), box.x1);
            const overlapR = Math.min(Math.max(a.x, b.x), box.x2);
            if (overlapR - overlapL > eps) hits++;
          }
        } else if (Math.abs(a.x - b.x) < eps) {
          const x = a.x;
          if (box.x1 < x && x < box.x2) {
            const overlapT = Math.max(Math.min(a.y, b.y), box.y1);
            const overlapB = Math.min(Math.max(a.y, b.y), box.y2);
            if (overlapB - overlapT > eps) hits++;
          }
        }
      }
    }
    return hits;
  }

  let bestPts = candidates[0].pts;
  let bestScore = Infinity;
  let bestColl = Infinity;

  for (const c of candidates) {
    const coll = countCollisions(c.pts);
    const score = c.base + coll * 200;
    if (coll < bestColl || (coll === bestColl && score < bestScore)) {
      bestScore = score;
      bestColl = coll;
      bestPts = c.pts;
    }
  }

  return bestPts;
}

function renderDefs(s: StyleProfile): string {
  const lines: string[] = ["  <defs>"];

  for (const [flow, color] of Object.entries(s.arrowColors)) {
    lines.push(
      `    <marker id="arrow-${flow}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">`
    );
    lines.push(`      <polygon points="0 0, 10 3.5, 0 7" fill="${color}"/>`);
    lines.push(`    </marker>`);
  }
  lines.push(
    `    <marker id="arrow-neutral" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">`
  );
  lines.push(`      <polygon points="0 0, 10 3.5, 0 7" fill="${s.arrowColors.neutral}"/>`);
  lines.push(`    </marker>`);

  if (s.nodeShadow === "url(#shadowSoft)") {
    lines.push(`    <filter id="shadowSoft" x="-20%" y="-20%" width="140%" height="160%">`);
    lines.push(`      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.12"/>`);
    lines.push(`    </filter>`);
  }
  if (s.nodeShadow === "url(#shadowGlass)") {
    lines.push(`    <filter id="shadowGlass" x="-20%" y="-20%" width="140%" height="160%">`);
    lines.push(`      <feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#020617" flood-opacity="0.28"/>`);
    lines.push(`    </filter>`);
  }

  if (s.backgroundExtra === "blueprintGrid") {
    lines.push(`    <pattern id="blueprintGrid" width="32" height="32" patternUnits="userSpaceOnUse">`);
    lines.push(`      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#0ea5e9" stroke-opacity="0.12" stroke-width="1"/>`);
    lines.push(`    </pattern>`);
  }
  if (s.backgroundExtra === "terminalGradient") {
    lines.push(`    <linearGradient id="terminalGradient" x1="0%" y1="0%" x2="100%" y2="100%">`);
    lines.push(`      <stop offset="0%" stop-color="#0f0f1a"/>`);
    lines.push(`      <stop offset="100%" stop-color="#1a1a2e"/>`);
    lines.push(`    </linearGradient>`);
  }
  if (s.backgroundExtra === "glassGradient") {
    lines.push(`    <linearGradient id="glassGradient" x1="0%" y1="0%" x2="100%" y2="100%">`);
    lines.push(`      <stop offset="0%" stop-color="#0f172a"/>`);
    lines.push(`      <stop offset="100%" stop-color="#1e293b"/>`);
    lines.push(`    </linearGradient>`);
  }

  lines.push(`    <style>`);
  lines.push(`      text { font-family: ${s.fontFamily}; }`);
  lines.push(`      .title { font-size: ${s.titleSize}px; font-weight: 700; fill: ${s.titleFill}; }`);
  lines.push(`      .subtitle { font-size: ${s.subtitleSize}px; font-weight: 500; fill: ${s.subtitleFill}; }`);
  lines.push(`      .section-label { font-size: 13px; font-weight: 700; fill: ${s.sectionLabelFill}; letter-spacing: 1.4px; }`);
  lines.push(`      .section-sub { font-size: 12px; font-weight: 500; fill: ${s.sectionSubFill}; }`);
  lines.push(`      .node-title { font-size: 14px; font-weight: 600; fill: ${s.textPrimary}; }`);
  lines.push(`      .node-sub { font-size: 11px; font-weight: 400; fill: ${s.textSecondary}; }`);
  lines.push(`      .node-type { font-size: ${s.typeLabelSize}px; font-weight: 700; fill: ${s.typeLabelFill}; letter-spacing: 0.08em; }`);
  lines.push(`      .arrow-label { font-size: 11px; font-weight: 600; fill: ${s.arrowLabelFill}; }`);
  lines.push(`      .legend { font-size: 12px; font-weight: 500; fill: ${s.legendFill}; }`);
  lines.push(`    </style>`);
  lines.push(`  </defs>`);

  return lines.join("\n");
}

function renderCanvas(s: StyleProfile, w: number, h: number): string {
  const lines: string[] = [];
  if (s.backgroundExtra === "terminalGradient") {
    lines.push(`  <rect width="${w}" height="${h}" fill="url(#terminalGradient)"/>`);
  } else if (s.backgroundExtra === "glassGradient") {
    lines.push(`  <rect width="${w}" height="${h}" fill="url(#glassGradient)"/>`);
  } else {
    lines.push(`  <rect width="${w}" height="${h}" fill="${s.background}"/>`);
  }
  if (s.backgroundExtra === "blueprintGrid") {
    lines.push(`  <rect width="${w}" height="${h}" fill="url(#blueprintGrid)"/>`);
  }
  return lines.join("\n");
}

function renderTitleBlock(s: StyleProfile, spec: DiagramSpec, w: number): { svg: string; cursorY: number } {
  const lines: string[] = [];
  const title = escapeXml(spec.title);
  const subtitle = spec.subtitle ? escapeXml(spec.subtitle) : "";

  if (s.titleAlign === "center") {
    lines.push(`  <text x="${w / 2}" y="38" text-anchor="middle" class="title">${title}</text>`);
    let cursorY = 58;
    if (subtitle) {
      lines.push(`  <text x="${w / 2}" y="${cursorY}" text-anchor="middle" class="subtitle">${subtitle}</text>`);
      cursorY += 18;
    }
    return { svg: lines.join("\n"), cursorY: cursorY + 14 };
  }

  lines.push(`  <text x="48" y="38" text-anchor="start" class="title">${title}</text>`);
  let cursorY = 58;
  if (subtitle) {
    lines.push(`  <text x="48" y="${cursorY}" text-anchor="start" class="subtitle">${subtitle}</text>`);
    cursorY += 18;
  }
  if (s.titleDivider) {
    lines.push(`  <line x1="48" y1="${cursorY + 8}" x2="${w - 48}" y2="${cursorY + 8}" stroke="${s.sectionStroke}" stroke-width="1"/>`);
    cursorY += 22;
  }
  return { svg: lines.join("\n"), cursorY: cursorY + 10 };
}

function renderNodeShape(
  shape: NodeShape,
  x: number,
  y: number,
  w: number,
  h: number,
  cx: number,
  cy: number,
  s: StyleProfile,
  overrideFill?: string,
  overrideStroke?: string
): string {
  const r = s.nodeRadius;
  const fill = overrideFill ?? s.nodeFill;
  const stroke = overrideStroke ?? s.nodeStroke;
  const sw = s.nodeStrokeWidth;
  const filter = s.nodeShadow ? ` filter="${s.nodeShadow}"` : "";

  const bgRect = isTransparent(fill)
    ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${s.background}"/>\n    `
    : "";

  switch (shape) {
    case "cylinder": {
      const ry = 10;
      return [
        `<ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${fill}" stroke="none"/>`,
        `<line x1="${x}" y1="${y + ry}" x2="${x}" y2="${y + h - ry}" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="${x + w}" y1="${y + ry}" x2="${x + w}" y2="${y + h - ry}" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      ].join("\n    ");
    }
    case "hexagon": {
      const hx = w * 0.2;
      const pts = [
        `${x + hx},${y}`,
        `${x + w - hx},${y}`,
        `${x + w},${cy}`,
        `${x + w - hx},${y + h}`,
        `${x + hx},${y + h}`,
        `${x},${cy}`,
      ].join(" ");
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
    case "diamond": {
      const hw = w / 2, hh = h / 2;
      return `<polygon points="${cx},${y} ${cx + hw},${cy} ${cx},${y + h} ${cx - hw},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
    case "double_rect": {
      return [
        `<rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="${Math.max(r - 3, 4)}" fill="none" stroke="${stroke}" stroke-width="1" opacity="0.6"/>`,
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`
      ].join("\n    ");
    }
    case "document": {
      const fold = Math.min(16, w * 0.15);
      const path = `M ${x} ${y} L ${x + w - fold} ${y} L ${x + w} ${y + fold} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
      const foldPath = `M ${x + w - fold} ${y} L ${x + w - fold} ${y + fold} L ${x + w} ${y + fold}`;
      return [
        `<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`,
        `<path d="${foldPath}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`,
      ].join("\n    ");
    }
    case "folder": {
      const tabW = Math.min(50, w * 0.3);
      const tabH = 14;
      const path = `M ${x} ${y + tabH} L ${x + tabW * 0.4} ${y + tabH} L ${x + tabW * 0.55} ${y} L ${x + tabW} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
      return `<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`;
    }
    case "terminal": {
      return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`,
        `<rect x="${x}" y="${y}" width="${w}" height="16" rx="${r}" fill="#374151" opacity="0.9"/>`,
        `<circle cx="${x + 14}" cy="${y + 8}" r="3.5" fill="#ef4444"/>`,
        `<circle cx="${x + 26}" cy="${y + 8}" r="3.5" fill="#f59e0b"/>`,
        `<circle cx="${x + 38}" cy="${y + 8}" r="3.5" fill="#10b981"/>`,
      ].join("\n    ");
    }
    case "speech": {
      const tail = 14;
      const path = [
        `M ${x + r} ${y}`,
        `L ${x + w - r} ${y}`,
        `Q ${x + w} ${y} ${x + w} ${y + r}`,
        `L ${x + w} ${y + h - r}`,
        `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
        `L ${x + 24} ${y + h}`,
        `L ${x + 12} ${y + h + tail}`,
        `L ${x + 16} ${y + h}`,
        `L ${x + r} ${y + h}`,
        `Q ${x} ${y + h} ${x} ${y + h - r}`,
        `L ${x} ${y + r}`,
        `Q ${x} ${y} ${x + r} ${y}`,
        `Z`,
      ].join(" ");
      return `<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`;
    }
    case "user_avatar": {
      const circleR = 16;
      const avatarCx = x + 22;
      const avatarCy = cy;
      return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`,
        `<circle cx="${avatarCx}" cy="${avatarCy}" r="${circleR}" fill="${s.arrowColors.read}22" stroke="${s.arrowColors.read}" stroke-width="1.4"/>`,
        `<circle cx="${avatarCx}" cy="${avatarCy - 5}" r="4.5" fill="${s.arrowColors.read}"/>`,
        `<path d="M ${avatarCx - 8} ${avatarCy + 9} Q ${avatarCx} ${avatarCy + 2} ${avatarCx + 8} ${avatarCy + 9}" fill="none" stroke="${s.arrowColors.read}" stroke-width="1.8"/>`,
      ].join("\n    ");
    }
    case "bot": {
      return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`,
        `<circle cx="${cx - 10}" cy="${cy - 2}" r="4" fill="${s.arrowColors.write}"/>`,
        `<circle cx="${cx + 10}" cy="${cy - 2}" r="4" fill="${s.arrowColors.write}"/>`,
        `<rect x="${cx - 8}" y="${cy + 8}" width="16" height="4" rx="2" fill="${s.textMuted}"/>`,
      ].join("\n    ");
    }
    case "icon_box": {
      return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`,
        `<rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${h - 20}" rx="${Math.max(r - 4, 4)}" fill="${s.arrowColors.control}15"/>`,
      ].join("\n    ");
    }
    case "dashed_container": {
      return `${bgRect}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" fill-opacity="0.5" stroke="${stroke}" stroke-width="1" stroke-dasharray="6 3"/>`;
    }
    case "message_bus": {
      return `${bgRect}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    }
    default: {
      return `${bgRect}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${filter}/>`;
    }
  }
}

function renderNode(node: DiagramNode, pos: NodeLayout, s: StyleProfile, styleName: DiagramStyle): string {
  const x = pos.x - pos.w / 2;
  const y = pos.y - pos.h / 2;
  const shape = node.shape || "rect";

  let nodeFill = s.nodeFill;
  let nodeStroke = s.nodeStroke;
  if (node.componentType && COMPONENT_COLORS[styleName]?.[node.componentType]) {
    const cc = COMPONENT_COLORS[styleName][node.componentType];
    nodeFill = cc.fill;
    nodeStroke = cc.stroke;
  }

  let iconSvg = "";
  let labelOffsetX = 0;
  if (node.icon && PRODUCT_ICONS[node.icon]) {
    const iconDef = PRODUCT_ICONS[node.icon];
    iconSvg = `<g transform="translate(${x + 8}, ${pos.y - 14})">${iconDef.svgElements.join("")}</g>`;
    labelOffsetX = 16;
  }

  const typeLabel = node.typeLabel
    ? `<text x="${x + 8}" y="${y + 14}" class="node-type">${escapeXml(node.typeLabel)}</text>`
    : "";

  const mainLabelY = node.typeLabel ? pos.y + 6 : pos.y + 1;
  const mainLabel = node.sublabel
    ? `<text x="${pos.x + labelOffsetX}" y="${mainLabelY - 5}" text-anchor="middle" class="node-title">${escapeXml(node.label)}</text>
       <text x="${pos.x + labelOffsetX}" y="${mainLabelY + 9}" text-anchor="middle" class="node-sub">${escapeXml(node.sublabel)}</text>`
    : `<text x="${pos.x + labelOffsetX}" y="${mainLabelY + 4}" text-anchor="middle" class="node-title">${escapeXml(node.label)}</text>`;

  let tags = "";
  if (node.tags && node.tags.length > 0) {
    let tagX = x + 8;
    const tagY = y + pos.h - 20;
    const tagParts: string[] = [];
    for (const tag of node.tags) {
      const tw = Math.max(48, tag.label.length * 7 + 14);
      tagParts.push(`<rect x="${tagX}" y="${tagY}" width="${tw}" height="16" rx="3" fill="${tag.fill || "#eff6ff"}" stroke="${tag.stroke || "#bfdbfe"}" stroke-width="1"/>`);
      tagParts.push(`<text x="${tagX + tw / 2}" y="${tagY + 11}" text-anchor="middle" font-size="10" font-weight="500" fill="${tag.textFill || s.arrowColors.read}">${escapeXml(tag.label)}</text>`);
      tagX += tw + 6;
    }
    tags = tagParts.join("\n    ");
  }

  return `  <g>
    ${renderNodeShape(shape, x, y, pos.w, pos.h, pos.x, pos.y, s, nodeFill, nodeStroke)}
    ${iconSvg}
    ${typeLabel}
    ${mainLabel}
    ${tags}
  </g>`;
}

function renderArrow(
  arrow: DiagramArrow,
  positions: Map<string, NodeLayout>,
  obstacles: Bounds[],
  s: StyleProfile
): string {
  const from = positions.get(arrow.from);
  const to = positions.get(arrow.to);
  if (!from || !to) return "";

  const route = buildOrthRoute(from, to, obstacles, positions);
  if (route.length < 2) return "";

  const flow = arrow.flow || "neutral";
  const color = arrowColor(s, flow);
  const dash = arrowDash(s, flow, arrow.dashed);
  const markerId = `arrow-${flow}`;
  const dashAttr = dash !== "none" ? ` stroke-dasharray="${dash}"` : "";

  const pts = route.map((pt) => `${pt.x},${pt.y}`).join(" ");
  let svg = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${s.arrowWidth}"${dashAttr} marker-end="url(#${markerId})"/>`;

  if (arrow.label && route.length >= 2) {
    const midIdx = Math.floor((route.length - 1) / 2);
    const a = route[midIdx];
    const b = route[midIdx + 1];
    const lx = (a.x + b.x) / 2;
    const ly = (a.y + b.y) / 2;

    const isH = Math.abs(a.y - b.y) < 2;
    const offsetX = isH ? 0 : 8 + measureText(arrow.label) * 0.3;
    const offsetY = isH ? -12 : 0;
    const tx = lx + offsetX;
    const ty = ly + offsetY;

    const tw = Math.max(36, measureText(arrow.label) * 0.6 + 14);

    svg += `\n    <rect x="${tx - tw / 2}" y="${ty - 10}" width="${tw}" height="20" rx="6" fill="${s.arrowLabelBg}" opacity="${s.arrowLabelOpacity}"/>`;
    svg += `\n    <text x="${tx}" y="${ty + 4}" text-anchor="middle" class="arrow-label">${escapeXml(arrow.label)}</text>`;
  }

  return svg;
}

function renderContainerSection(
  container: DiagramContainer,
  bounds: Bounds,
  s: StyleProfile
): string {
  const { x1, y1, x2, y2 } = bounds;
  const w = x2 - x1;
  const h = y2 - y1;
  const rx = s.name === "Notion Clean" ? 4 : 12;

  const lines: string[] = [];
  const dashAttr = s.sectionDash ? ` stroke-dasharray="${s.sectionDash}"` : "";

  let cFill = s.sectionFill;
  let cStroke = s.sectionStroke;
  let cDashAttr = dashAttr;
  let labelText = s.sectionUpper ? escapeXml(container.label.toUpperCase()) : escapeXml(container.label);

  if (container.containerType === "security_group") {
    cStroke = "#fb7185";
    cDashAttr = ` stroke-dasharray="4,4"`;
    cFill = "transparent";
    labelText = `${escapeXml(container.label)} ${container.portLabel ? escapeXml(container.portLabel) : ""}`;
  } else if (container.containerType === "region") {
    cStroke = "#fbbf24";
    cDashAttr = ` stroke-dasharray="8,4"`;
    cFill = "rgba(251,191,36,0.05)";
    labelText = escapeXml(container.label);
  }

  lines.push(`  <rect x="${x1}" y="${y1}" width="${w}" height="${h}" rx="${rx}" fill="${cFill}" stroke="${cStroke}" stroke-width="1.4"${cDashAttr}/>`);
  lines.push(`  <text x="${x1 + 16}" y="${y1 + 20}" class="section-label">${labelText}</text>`);

  if (container.subtitle) {
    lines.push(`  <text x="${x1 + 16}" y="${y1 + 36}" class="section-sub">${escapeXml(container.subtitle)}</text>`);
  }

  if (container.sideLabel) {
    lines.push(`  <text x="${x1 - 12}" y="${y1 + h / 2}" text-anchor="end" dominant-baseline="middle" font-size="13" font-weight="600" fill="${s.textSecondary}">${escapeXml(container.sideLabel)}</text>`);
  }

  return lines.join("\n");
}

function renderLegend(
  legend: DiagramLegend[],
  s: StyleProfile,
  w: number,
  h: number
): string {
  if (legend.length === 0) return "";

  const lines: string[] = [];
  const startX = 48;
  let curY = h - 24 - legend.length * 20;

  for (const item of legend) {
    const color = arrowColor(s, item.flow);
    const dash = arrowDash(s, item.flow);
    const dashAttr = dash !== "none" ? ` stroke-dasharray="${dash}"` : "";

    lines.push(`  <line x1="${startX}" y1="${curY}" x2="${startX + 28}" y2="${curY}" stroke="${color}" stroke-width="${s.arrowWidth}"${dashAttr} marker-end="url(#arrow-${item.flow})"/>`);
    lines.push(`  <text x="${startX + 36}" y="${curY + 4}" class="legend">${escapeXml(item.label)}</text>`);
    curY += 20;
  }

  return lines.join("\n");
}

function renderFooter(footer: string | undefined, s: StyleProfile, w: number, h: number): string {
  if (!footer) return "";
  return `  <text x="${w - 48}" y="${h - 12}" text-anchor="end" font-size="11" font-weight="500" fill="${s.textMuted}">${escapeXml(footer)}</text>`;
}

export function renderDiagramSvg(spec: DiagramSpec): string {
  const s = STYLES[spec.style] || STYLES["flat-icon"];
  const styleName = spec.style;

  const preliminary = layoutWithContainers(
    spec.nodes,
    spec.arrows,
    spec.containers,
    960
  );

  const w = Math.max(960, preliminary.maxLayerW + 96);

  const { positions, containerBounds } =
    w > 960
      ? layoutWithContainers(spec.nodes, spec.arrows, spec.containers, w)
      : preliminary;

  const nodeObstacles = spec.nodes
    .map((n) => {
      const p = positions.get(n.id);
      return p ? nodeBounds(p) : null;
    })
    .filter((b): b is Bounds => b !== null);

  const allObstacles = [...nodeObstacles, ...[...containerBounds.values()]];

  const maxY = Math.max(
    TITLE_BLOCK_H + 80,
    ...spec.nodes.map((n) => {
      const p = positions.get(n.id);
      return p ? p.y + p.h / 2 : 0;
    }),
    ...[...containerBounds.values()].map((b) => b.y2)
  );

  const legendH = spec.legend.length > 0 ? spec.legend.length * 20 + 34 : 0;
  const footerH = spec.footer ? 24 : 0;
  const h = Math.max(320, maxY + 60 + legendH + footerH);

  const defs = renderDefs(s);
  const canvas = renderCanvas(s, w, h);
  const { svg: titleBlock } = renderTitleBlock(s, spec, w);

  const containerSvg = spec.containers
    .map((c) => {
      const b = containerBounds.get(c.id);
      return b ? renderContainerSection(c, b, s) : "";
    })
    .join("\n");

  const arrowSvg = spec.arrows
    .map((a) => renderArrow(a, positions, allObstacles, s))
    .join("\n");

  const nodeSvg = spec.nodes
    .map((n) => {
      const p = positions.get(n.id);
      return p ? renderNode(n, p, s, styleName) : "";
    })
    .join("\n");

  const legendSvg = renderLegend(spec.legend, s, w, h);
  const footerSvg = renderFooter(spec.footer, s, w, h);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    defs,
    canvas,
    titleBlock,
    containerSvg,
    arrowSvg,
    nodeSvg,
    legendSvg,
    footerSvg,
    "</svg>",
  ].join("\n");
}
