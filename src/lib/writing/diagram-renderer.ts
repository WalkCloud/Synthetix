import type { DiagramSpec, DiagramNode } from "./diagram-spec";

const PALETTE = {
  blueprint: {
    bg: "#f8fafc",
    grid: "#e2e8f0",
    box: "#ffffff",
    boxStroke: "#334155",
    boxFill: "#f1f5f9",
    arrow: "#475569",
    arrowHead: "#334155",
    title: "#0f172a",
    subtitle: "#64748b",
    label: "#1e293b",
    accent: "#3b82f6",
  },
  notion: {
    bg: "#ffffff",
    grid: "#f1f5f9",
    box: "#ffffff",
    boxStroke: "#e2e8f0",
    boxFill: "#fafafa",
    arrow: "#94a3b8",
    arrowHead: "#64748b",
    title: "#1a1a1a",
    subtitle: "#9ca3af",
    label: "#374151",
    accent: "#6366f1",
  },
};

type Palette = keyof typeof PALETTE;

function layoutNodes(nodes: DiagramNode[], width: number, _height: number): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const cellW = width / (cols + 1);
  const cellH = 90;

  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(node.id, {
      x: cellW * (col + 1),
      y: 80 + row * cellH,
    });
  });

  return positions;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderDiagramSvg(spec: DiagramSpec): string {
  const p = PALETTE[(spec.style as Palette) || "blueprint"] || PALETTE.blueprint;
  const w = 800;
  const nodePositions = layoutNodes(spec.nodes, w, 500);

  const boxW = 150;
  const boxH = 44;

  const defs = `
    <defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="${p.arrowHead}" />
      </marker>
      <filter id="shadow" x="-4%" y="-4%" width="108%" height="116%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#00000012"/>
      </filter>
    </defs>`;

  const titleBlock = `
    <text x="${w / 2}" y="30" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600" fill="${p.title}">${escapeXml(spec.title)}</text>
    ${spec.purpose ? `<text x="${w / 2}" y="50" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="${p.subtitle}">${escapeXml(spec.purpose)}</text>` : ""}`;

  const gridLines = Array.from({ length: 9 }, (_, i) => {
    const x = (i + 1) * (w / 10);
    return `<line x1="${x}" y1="0" x2="${x}" y2="600" stroke="${p.grid}" stroke-width="0.5" stroke-dasharray="4 4"/>`;
  }).join("\n    ");

  const nodeSvgs = spec.nodes.map((node) => {
    const pos = nodePositions.get(node.id);
    if (!pos) return "";
    const x = pos.x - boxW / 2;
    const y = pos.y - boxH / 2;
    return `
    <g filter="url(#shadow)">
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" fill="${p.boxFill}" stroke="${p.boxStroke}" stroke-width="1.2"/>
      <text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="500" fill="${p.label}">${escapeXml(node.label)}</text>
    </g>`;
  }).join("");

  const arrowSvgs = spec.arrows.map((arrow) => {
    const from = nodePositions.get(arrow.from);
    const to = nodePositions.get(arrow.to);
    if (!from || !to) return "";

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return "";

    const offsetStart = boxH / 2 + 4;
    const offsetEnd = boxH / 2 + 8;
    const sx = from.x + (dx / dist) * offsetStart;
    const sy = from.y + (dy / dist) * offsetStart;
    const ex = to.x - (dx / dist) * offsetEnd;
    const ey = to.y - (dy / dist) * offsetEnd;

    return `    <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${p.arrow}" stroke-width="1.5" marker-end="url(#arrowhead)"/>`;
  }).join("\n");

  const h = Math.max(300, Math.max(...Array.from(nodePositions.values()).map((p) => p.y)) + 80);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    defs,
    `  <rect width="${w}" height="${h}" fill="${p.bg}" rx="12"/>`,
    `  ${gridLines}`,
    titleBlock,
    arrowSvgs,
    nodeSvgs,
    "</svg>",
  ].join("\n");
}
