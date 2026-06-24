export interface ReferenceChunk {
  sourceAnchor?: string | null;
  sectionTitle: string;
  relevanceScore: number;
}

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
  /** Entity description from knowledge graph */
  description?: string;
  /** Reference chunks: source anchor → writing section mapping with scores */
  referenceChunks?: ReferenceChunk[];
  /** Draft-specific summary fields for the central document node */
  draftStatus?: string;
  totalSections?: number;
  completedSections?: number;
  sectionsWithReferences?: number;
  totalReferences?: number;
  uniqueDocuments?: number;
  mostReferencedDoc?: string | null;
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
