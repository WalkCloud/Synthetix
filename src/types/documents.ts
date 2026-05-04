export const SUPPORTED_FORMATS = [
  "pdf", "docx", "pptx", "xlsx", "html", "epub", "txt", "md"
] as const;
export type SupportedFormat = typeof SUPPORTED_FORMATS[number];

export type DocumentStatus =
  | "uploading"
  | "converting"
  | "splitting"
  | "embedding"
  | "indexing"
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
  createdAt: string;
  updatedAt: string;
  chunks?: ChunkMeta[];
  tags?: TagMeta[];
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

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  title: string | null;
  content: string;
  score: number;
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
