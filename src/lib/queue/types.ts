export type TaskType =
  | "document_upload"
  | "document_convert"
  | "rag_index"
  | "chapter_generate"
  | "chapter_summarize"
  | "outline_generate"
  | "draft_generate_all";

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
