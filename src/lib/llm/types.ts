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
