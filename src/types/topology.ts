export interface TopologyNode {
  id: string;
  type: "draft" | "reference" | "entity";
  label: string;
  format: string;
  size?: number;
  referenceCount: number;
  relevanceScore: number;
  /** Entity-specific: entity type (person, concept, organization, etc.) */
  entityType?: string;
}

export interface TopologyEdge {
  source: string;
  target: string;
  weight: number;
  sectionIds: string[];
  sectionLabels: string[];
  /** Entity edge: relationship description */
  description?: string;
}

export interface TopologyStats {
  totalReferences: number;
  uniqueDocuments: number;
  sectionsWithReferences: number;
  totalSections: number;
  mostReferencedDoc: string | null;
  coverage: string;
  /** Knowledge graph stats */
  totalEntities?: number;
  totalRelations?: number;
  leafCount?: number;
}

export interface TopologyResponse {
  draft: { id: string; title: string; status: string };
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  stats: TopologyStats;
}

export type GraphViewMode = "documents" | "knowledge";
