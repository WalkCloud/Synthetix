export type TaskType =
  | "document_upload"
  | "document_convert"
  | "rag_index"
  | "chapter_generate"
  | "chapter_summarize"
  | "outline_generate";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

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
