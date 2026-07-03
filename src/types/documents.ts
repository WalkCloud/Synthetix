import type { DocumentPipeline } from "@/lib/documents/pipeline-stages";

export const SUPPORTED_FORMATS = [
  "pdf", "docx", "pptx", "xlsx", "html", "epub", "txt", "md", "csv"
] as const;
export type SupportedFormat = typeof SUPPORTED_FORMATS[number];

/**
 * Brainstorm document upload limits. Requirements/background docs are
 * expected to be modest; these caps prevent unreasonable uploads from
 * blowing the LLM context window while still covering typical PRDs.
 */
export const BRAINSTORM_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const BRAINSTORM_MAX_CONTENT_CHARS = 12000;

/** Derived <input accept> string so frontend and backend stay in sync. */
export const BRAINSTORM_ACCEPT = SUPPORTED_FORMATS.map((f) => `.${f}`).join(",");

export type DocumentStatus =
  | "uploading"
  | "pending"
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
  /**
   * Pipeline warnings surfaced to the user, e.g. a silent graph→basic
   * downgrade when the embedding model dimension is below 1536. Multi-line
   * when more than one warning accumulated. Optional: only present when set.
   */
  conversionWarning?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Total processing duration in milliseconds, from the earliest processing
   * task (convert) to the latest completed task. null while still processing
   * or if no processing tasks exist. Only present on detail responses.
   */
  processingDurationMs?: number | null;
  /**
   * ISO timestamp of when the latest processing run started (earliest task
   * createdAt). Used by the UI to show a live elapsed timer while processing.
   * null when no processing tasks exist.
   */
  processingStartedAt?: string | null;
  /**
   * "Time to usable": convert start → embed end (the linear pipeline).
   * The meaningful metric for users — how long until the document is
   * searchable. Excludes graph/wiki enhancement time.
   */
  basicDurationMs?: number | null;
  /**
   * Enhancement duration: graph + wiki background processing time.
   * Shown separately so users understand the doc is already usable
   * while enhancement continues.
   */
  enhancementDurationMs?: number | null;
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
   * Single consistent display status shared by the library list and the detail
   * page so the two never disagree (e.g. "enhancing" = basic retrieval ready
   * but Graph/Wiki still running). Computed server-side via computeDisplayStatus
   * from the same task-driven pipeline. Optional: legacy docs may omit it.
   */
  displayStatus?: "ready" | "enhancing" | "processing" | "failed" | "pending";
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

interface TagMeta {
  id: string;
  name: string;
}

interface DocumentImageMeta {
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
