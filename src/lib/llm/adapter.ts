import type {
  ChatChunk,
  ChatParams,
  ChatResponse,
  LLMProvider,
  ModelInfo,
} from "./types";

interface AdapterConfig {
  baseUrl: string;
  apiKey?: string;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

export class OpenAICompatibleAdapter implements LLMProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: AdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: false,
    };
    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }
    if (params.maxTokens !== undefined) {
      body.max_tokens = params.maxTokens;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Chat request failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? params.model,
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: true,
    };
    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }
    if (params.maxTokens !== undefined) {
      body.max_tokens = params.maxTokens;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Chat stream request failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) {
            continue;
          }

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            yield { content: "", done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{
                delta: { content?: string };
                finish_reason: string | null;
              }>;
            };
            const content = parsed.choices[0]?.delta?.content ?? "";
            const isDone = parsed.choices[0]?.finish_reason != null;
            yield { content, done: isDone };
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { content: "", done: true };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/v1/embeddings`;
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify({ input: texts, model: "text-embedding" }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Embed request failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map((item) => item.embedding);
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/v1/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: buildHeaders(this.apiKey),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    const url = `${this.baseUrl}/v1/models`;
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(this.apiKey),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Get models failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    const data = (await response.json()) as {
      data: Array<{ id: string; object?: string; type?: string }>;
    };

    return data.data.map((model) => ({
      id: model.id,
      name: model.id,
      type: model.object ?? model.type ?? "model",
    }));
  }
}
