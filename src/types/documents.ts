import type { DocumentPipeline } from "@/lib/documents/pipeline-stages";

export const SUPPORTED_FORMATS = [
  "pdf", "docx", "pptx", "xlsx", "html", "txt", "md"
] as const;
export type SupportedFormat = typeof SUPPORTED_FORMATS[number];

export type DocumentStatus =
  | "uploading"
  | "queued"
  | "converting"
  | "splitting"
  | "embedding"
  | "indexing"
  | "indexing_graph"
  | "ready"
  | "failed";

export interface DocumentMeta {
  id: string;
  originalName: string;
  originalFormat: string;
  originalSize: number;
  originalHash: string | null;
  status: DocumentStatus;
  parentId: string | null;
  tokenEstimate: number | null;
  wordCount: number | null;
  conversionMethod?: string | null;
  createdAt: string;
  updatedAt: string;
  chunks?: ChunkMeta[];
  tags?: TagMeta[];
  /**
   * Task-driven Processing Pipeline view (stage dots + percentages) for the
   * document detail page. Computed server-side from the document's real
   * async_tasks (convert / embed-index / graph) and attached by the library
   * document-detail API. Optional: only present on detail responses.
   */
  pipeline?: DocumentPipeline;
  /**
   * Position in the global document-convert queue (1-indexed). Only set when
   * `status === "queued"`. The library API computes this on the fly from
   * pending/running async_tasks. `total` is the total number of queued docs
   * (incl. one currently running) so the UI can show "Waiting 2 / 5".
   */
  queuePosition?: { rank: number; total: number };
}

export interface ChunkMeta {
  id: string;
  documentId: string;
  index: number;
  title: string | null;
  content: string;
  tokenCount: number | null;
  startPage: number | null;
  endPage: number | null;
  headingPath: string | null;
  embedModel: string | null;
}

export interface TagMeta {
  id: string;
  name: string;
}

export interface DocumentImageMeta {
  id: string;
  documentId: string;
  filename: string;
  url: string;
  altText: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  pageNumber: number | null;
}

export type SearchResultSource = "lightrag" | "direct_embedding" | "keyword" | "fused";
export type SearchRelevanceLabel = "high" | "medium" | "low" | "keyword" | "unknown";
export type SearchRerankStatus = "enabled" | "missing" | "failed";

export interface SearchResultDebug {
  semanticRank?: number;
  keywordRank?: number;
  vectorScore?: number;
  keywordScore?: number;
  fusionScore?: number;
  rerank?: SearchRerankStatus;
  mode?: string;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  title: string | null;
  content: string;
  score: number;
  rank?: number;
  source?: SearchResultSource;
  relevanceLabel?: SearchRelevanceLabel;
  matchedTerms?: string[];
  debug?: SearchResultDebug;
  images?: DocumentImageMeta[];
}

export interface DocumentListParams {
  page?: number;
  limit?: number;
  sort?: "createdAt" | "originalName" | "originalSize";
  order?: "asc" | "desc";
  format?: SupportedFormat;
  status?: DocumentStatus;
  tag?: string;
}
