export interface DiagramNode {
  id: string;
  label: string;
  row?: number;
  col?: number;
}

export interface DiagramArrow {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramSpec {
  type: string;
  title: string;
  purpose: string;
  style: "notion" | "claude" | "openai" | "blueprint";
  nodes: DiagramNode[];
  arrows: DiagramArrow[];
  placement: {
    position: "after_paragraph" | "before_heading" | "end_of_section";
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

  const nodes: DiagramNode[] = nodeLabels.map((label, i) => ({
    id: `n${i}`,
    label,
  }));

  const labelToId = new Map<string, string>();
  nodeLabels.forEach((label, i) => {
    labelToId.set(label.trim().toLowerCase(), `n${i}`);
  });

  const arrows: DiagramArrow[] = flowsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((flow) => {
      const parts = flow.split("->").map((s) => s.trim());
      if (parts.length < 2) return null;
      const fromId = labelToId.get(parts[0].toLowerCase()) || parts[0];
      const toId = labelToId.get(parts[parts.length - 1].toLowerCase()) || parts[parts.length - 1];
      return { from: fromId, to: toId };
    })
    .filter((a): a is DiagramArrow => a !== null);

  return {
    type: fields.type || "architecture",
    title: fields.title || "Untitled Diagram",
    purpose: fields.purpose || "",
    style: "blueprint",
    nodes,
    arrows,
    placement: {
      position: (fields.placement as DiagramSpec["placement"]["position"]) || "after_paragraph",
    },
  };
}
