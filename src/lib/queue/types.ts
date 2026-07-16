export type TaskType =
  | "document_convert"
  | "document_cleanup"
  | "document_segment"
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

export type WorkerOutcome =
  | { workerOutcome: true; status: "completed"; result: TaskResult }
  | { workerOutcome: true; status: "failed"; error: string; result?: TaskResult; progress?: number }
  | { workerOutcome: true; status: "cancelled"; error?: string; result?: TaskResult; progress?: number };

export type WorkerResult = TaskResult | WorkerOutcome;

export function completedOutcome(result: TaskResult): WorkerOutcome {
  return { workerOutcome: true, status: "completed", result };
}

export function failedOutcome(error: string, result?: TaskResult): WorkerOutcome {
  return { workerOutcome: true, status: "failed", error, result };
}

export function cancelledOutcome(error?: string, result?: TaskResult, progress?: number): WorkerOutcome {
  return { workerOutcome: true, status: "cancelled", error, result, progress };
}

export function isWorkerOutcome(result: WorkerResult): result is WorkerOutcome {
  return result.workerOutcome === true;
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
  onProgress: (progress: number) => void | Promise<void>,
) => Promise<WorkerResult>;
