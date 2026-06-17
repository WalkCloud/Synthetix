const TOPOLOGY_TYPES = new Set([
  "architecture",
  "deployment",
  "component",
  "security",
  "network-topology",
]);

const FLOW_TYPES = new Set([
  "flowchart",
  "data-flow",
  "sequence",
  "timeline",
]);

export interface DiagramPromptParams {
  prompt?: string;
  type?: string;
  title?: string;
  purpose?: string;
  nodes?: string;
  flows?: string;
  relationships?: string;
  groups?: string;
  boundaries?: string;
}

function isTopologyType(type?: string): boolean {
  return type ? TOPOLOGY_TYPES.has(type) : false;
}

function isFlowType(type?: string): boolean {
  return type ? FLOW_TYPES.has(type) : false;
}

function topologyLabel(type: string): string {
  if (type === "deployment" || type === "network-topology") {
    return "infrastructure topology diagram";
  }
  return `${type} topology diagram`;
}

export function buildDiagramGenerationPrompt(params: DiagramPromptParams): string {
  const type = params.type || "architecture";
  const parts: string[] = [];

  if (params.prompt) parts.push(params.prompt);

  if (isTopologyType(type)) {
    parts.push(topologyLabel(type));
    parts.push("Use containers/groups to show resource pools, platforms, operating domains, and physical isolation boundaries. Arrows should represent ownership, management scope, or dependency only, not business process order.");
  } else if (isFlowType(type)) {
    parts.push(`${type} diagram`);
  } else {
    parts.push(`${type} diagram`);
  }

  if (params.title) parts.push(`"${params.title}"`);
  if (params.purpose) parts.push(params.purpose);
  if (params.nodes) parts.push(`nodes: ${params.nodes}`);

  if (isTopologyType(type)) {
    const relationships = params.relationships || params.flows;
    if (relationships) parts.push(`relationships: ${relationships}`);
    if (params.groups) parts.push(`groups: ${params.groups}`);
    if (params.boundaries) parts.push(`physical isolation boundaries: ${params.boundaries}`);
  } else if (params.flows) {
    parts.push(`Flows: ${params.flows}`);
  }

  return parts.join(". ");
}
