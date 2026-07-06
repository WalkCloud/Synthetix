export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  streamOptions?: Record<string, unknown>;
  response_format?: { type: "json_object" } | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown> } };
}

export interface ChatChunk {
  content: string;
  reasoning?: string;
  done: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  finishReason?: string;
}

export interface EmbedResponse {
  embeddings: number[][];
  inputTokens: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  type: string;
}

export interface LLMProvider {
  chat(params: ChatParams): Promise<ChatResponse>;
  chatStream(params: ChatParams): AsyncGenerator<ChatChunk>;
  embed(texts: string[], model?: string, dimensions?: number): Promise<EmbedResponse>;
  testConnection(): Promise<boolean>;
  getModels(): Promise<ModelInfo[]>;
}
