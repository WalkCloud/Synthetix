export interface TopologyNode {
  id: string;
  type: "draft" | "reference";
  label: string;
  format: string;
  size?: number;
  referenceCount: number;
  relevanceScore: number;
}

export interface TopologyEdge {
  source: string;
  target: string;
  weight: number;
  sectionIds: string[];
  sectionLabels: string[];
}

export interface TopologyStats {
  totalReferences: number;
  uniqueDocuments: number;
  sectionsWithReferences: number;
  totalSections: number;
  mostReferencedDoc: string | null;
  coverage: string;
}

export interface TopologyResponse {
  draft: { id: string; title: string; status: string };
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  stats: TopologyStats;
}
