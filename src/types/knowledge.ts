export interface KnowledgeGraphEntity {
  entity_name: string;
  entity_type: string;
  description: string;
  source_id?: string;
  file_path?: string;
}

export interface KnowledgeGraphRelation {
  source_entity: string;
  target_entity: string;
  keywords: string[];
  description: string;
  weight: number;
  source_id?: string;
  file_path?: string;
}

export interface KnowledgeGraphSubgraph {
  entity: string;
  graph: {
    nodes: Array<{
      id: string;
      label: string;
      type: string;
      description: string;
    }>;
    edges: Array<{
      source: string;
      target: string;
      label: string;
      weight: number;
      description: string;
    }>;
  };
}

export interface EntityListResult {
  entities: string[];
  count: number;
}

export interface EntityDetailResult {
  entity: string;
  graph?: KnowledgeGraphSubgraph["graph"];
  error?: string;
}

export interface IndexResult {
  doc_id: string;
  chunks: number;
  status: string;
  index_mode: string;
  graph_entities?: number;
  storage: {
    kv: string;
    vector: string;
    graph: string;
  };
}

export interface SemanticSearchResult {
  chunks: Array<{
    chunk_id: string;
    content: string;
    title: string;
    score: number;
  }>;
  mode: string;
  total_chunks: number;
  entities?: KnowledgeGraphEntity[];
  relations?: KnowledgeGraphRelation[];
}

export interface ManageResult {
  status: string;
  error?: string;
  [key: string]: unknown;
}
