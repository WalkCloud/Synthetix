import { buildSpecFromStructuredJson, buildSpecFromRawPrompt } from "@/lib/writing/diagram-spec";
import { renderDiagramSvg } from "@/lib/writing/diagram-renderer";

type DiagramNodeInput = Record<string, unknown>;
type DiagramEdgeInput = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseJsonInput(code: string): { nodes: DiagramNodeInput[]; edges: DiagramEdgeInput[] } | null {
  try {
    const json = JSON.parse(code) as unknown;
    if (isRecord(json) && Array.isArray(json.nodes)) {
      return {
        nodes: json.nodes.filter(isRecord),
        edges: Array.isArray(json.arrows) ? json.arrows.filter(isRecord) : [],
      };
    }
  } catch (e) {
    console.warn("[diagram-parse] parseJsonInput failed:", e instanceof Error ? e.message : String(e));
  }
  return null;
}

export function parseMermaidBasic(code: string): { nodes: { id: string; label: string }[]; edges: { from: string; to: string; label?: string }[] } {
  const edges: { from: string; to: string; label?: string }[] = [];
  const nodeMap = new Map<string, { id: string; label: string }>();

  const ensureNode = (id: string, label?: string) => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, label: label || id });
    return nodeMap.get(id)!;
  };

  const labelRe = /\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}/;
  function extractLabel(text: string): string | undefined {
    const m = text.match(labelRe);
    return m ? (m[1] || m[2] || m[3]) : undefined;
  }

  // Updated regex: handles both bare IDs (A --> B) and labeled syntax (A[Label] --> B[Label])
  const edgeRegex = /([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?\s*(?:-\.-?>|--?>|==>)\s*(?:\|([^|]+)\|\s*)?([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?/g;
  let match: RegExpExecArray | null;
  while ((match = edgeRegex.exec(code)) !== null) {
    const fromId = match[1];
    const toId = match[3];
    const edgeLabel = match[2];
    ensureNode(fromId);
    ensureNode(toId);
    // Extract labels from the matched text for better node naming
    const fullMatch = match[0];
    const toIdIdx = fullMatch.lastIndexOf(toId);
    if (toIdIdx > 0) {
      const fromPart = fullMatch.substring(0, toIdIdx);
      const toPart = fullMatch.substring(toIdIdx);
      const fromLabel = extractLabel(fromPart);
      const toLabel = extractLabel(toPart);
      if (fromLabel && nodeMap.get(fromId)!.label === fromId) {
        nodeMap.get(fromId)!.label = fromLabel;
      }
      if (toLabel && nodeMap.get(toId)!.label === toId) {
        nodeMap.get(toId)!.label = toLabel;
      }
    }
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
  const isJson = trimmedCode.startsWith("{") || trimmedCode.startsWith("[");

  if (isJson) {
    // JSON path — validate fully, never fall through to mermaid parser
    try {
      const json = JSON.parse(trimmedCode);
      if (json.nodes && Array.isArray(json.nodes)) {
        const spec = buildSpecFromStructuredJson(json);
        if (spec.nodes.length > 0) return renderDiagramSvg(spec);
        throw new Error(
          "LLM returned valid JSON but with no diagram nodes. " +
          "Expected a 'nodes' array with at least one entry. " +
          "Raw keys: " + Object.keys(json).join(", ")
        );
      }
      throw new Error(
        "LLM returned JSON without a 'nodes' array. " +
        "Top-level keys: " + Object.keys(json).join(", ")
      );
    } catch (e) {
      // Re-throw our own descriptive errors
      if (e instanceof Error && e.message.startsWith("LLM returned")) throw e;
      throw new Error(
        "Failed to parse LLM output as JSON: " + (e instanceof Error ? e.message : String(e))
      );
    }
  }

  // Mermaid syntax path — only reached for non-JSON input
  const { nodes, edges } = parseMermaidBasic(trimmedCode);
  if (nodes.length === 0) {
    throw new Error(
      "Could not parse any nodes from mermaid syntax. " +
      "Ensure the diagram uses 'A[Label] --> B[Label]' or JSON format."
    );
  }

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
