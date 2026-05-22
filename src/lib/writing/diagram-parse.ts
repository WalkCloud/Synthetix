import { buildSpecFromStructuredJson, buildSpecFromRawPrompt } from "@/lib/writing/diagram-spec";
import { renderDiagramSvg } from "@/lib/writing/diagram-renderer";

export function parseJsonInput(code: string): { nodes: any[]; edges: any[] } | null {
  try {
    const json = JSON.parse(code);
    if (json.nodes && Array.isArray(json.nodes)) {
      return { nodes: json.nodes, edges: json.arrows || [] };
    }
  } catch {}
  return null;
}

export function parseMermaidBasic(code: string): { nodes: any[]; edges: any[] } {
  const nodes: { id: string; label: string }[] = [];
  const edges: { from: string; to: string; label?: string }[] = [];
  const nodeMap = new Map<string, { id: string; label: string }>();

  const ensureNode = (id: string, label?: string) => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, label: label || id });
    return nodeMap.get(id)!;
  };

  const edgeRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:-\.-?>|--?>|==>)\s*(?:\|([^|]+)\|\s*)?([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = edgeRegex.exec(code)) !== null) {
    const fromId = match[1];
    const toId = match[3];
    const edgeLabel = match[2];
    ensureNode(fromId);
    ensureNode(toId);
    edges.push({ from: fromId, to: toId, label: edgeLabel });
  }

  const nodeRegex = /([A-Za-z_][A-Za-z0-9_]*)\[(?:([^\]]+))\]/g;
  while ((match = nodeRegex.exec(code)) !== null) {
    ensureNode(match[1], match[2]);
  }

  return { nodes: [...nodeMap.values()], edges };
}

export function renderDiagramFromCode(code: string, title?: string): string {
  const trimmedCode = code.trim();
  const jsonInput = parseJsonInput(trimmedCode);

  if (jsonInput) {
    const spec = buildSpecFromStructuredJson(JSON.parse(trimmedCode));
    if (spec.nodes.length === 0) throw new Error("No nodes found in diagram JSON");
    return renderDiagramSvg(spec);
  }

  const { nodes, edges } = parseMermaidBasic(trimmedCode);
  if (nodes.length === 0) throw new Error("Could not parse any nodes from code");

  const spec = buildSpecFromRawPrompt(
    [
      `type=architecture`,
      `title=${title || "Diagram"}`,
      `style=flat-icon`,
      `nodes=${nodes.map((n) => n.label).join(",")}`,
      `flows=${edges.map((e) => `${e.from}->${e.to}${e.label ? `(${e.label})` : ""}`).join(",")}`,
    ].join("\n")
  );
  return renderDiagramSvg(spec);
}
