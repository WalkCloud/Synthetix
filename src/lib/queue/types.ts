export type TaskType =
  | "document_convert"
  | "document_cleanup"
  | "rag_embed_index"
  | "rag_index"
  | "wiki_synthesize"
  | "outline_generate"
  | "draft_generate_all"
  | `_test_${string}`;

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type SplitStrategy = "structure-llm" | "heading-only";
export type IndexTarget = "full" | "original" | "chunks";
export type IndexMode = "basic" | "graph";
export type QueryMode = "local" | "global" | "hybrid" | "mix" | "naive" | "bypass";

export interface ProcessingOptions {
  llmModelId?: string;
  embedModelId?: string;
  contextUsage?: number;
  splitStrategy?: SplitStrategy;
  indexTarget?: IndexTarget;
  indexMode?: IndexMode;
  autoSplit?: boolean;
  // When true, ignore the Docling conversion cache and re-convert from source
  // (e.g. after a converter upgrade). Defaults to false so reprocess of an
  // unchanged source file is fast.
  forceReconnect?: boolean;
  // When false, skip the Wiki synthesis phase (saves tokens). Defaults to true.
  // Wiki synthesis runs AFTER basic index (+ optional graph) as an async,
  // non-blocking phase that precipitates synthesized knowledge entries.
  wikiEnabled?: boolean;
}

export interface TaskPayload {
  [key: string]: unknown;
}

export interface TaskResult {
  [key: string]: unknown;
}

export interface TaskInfo {
  id: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  result?: TaskResult;
  error?: string;
}

export type WorkerFn = (
  payload: TaskPayload,
  onProgress: (progress: number) => void,
) => Promise<TaskResult>;
