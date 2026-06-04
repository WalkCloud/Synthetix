import type {
  ChatChunk,
  ChatParams,
  ChatResponse,
  EmbedResponse,
  LLMProvider,
  ModelInfo,
} from "./types";
import {
  normalizeProviderBaseUrl,
  buildChatCompletionsUrl,
  buildEmbeddingsUrl,
  buildModelsUrl,
  buildProviderHeaders,
} from "./provider-endpoints";

interface AdapterConfig {
  baseUrl: string;
  apiKey?: string;
}

const FETCH_TIMEOUT_MS = 300_000;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1.5));
}

function estimateMessagesTokens(messages: ChatParams["messages"]): number {
  return estimateTokens(messages.map((message) => message.content).join("\n"));
}

export class OpenAICompatibleAdapter implements LLMProvider {
  private readonly normalizedBase: string;
  private readonly apiKey?: string;

  constructor(config: AdapterConfig) {
    this.normalizedBase = normalizeProviderBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const url = buildChatCompletionsUrl(this.normalizedBase);
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: false,
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
    if (params.response_format) body.response_format = params.response_format;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildProviderHeaders(this.apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Chat request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string; reasoning_content?: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    const msg = data.choices[0]?.message;
    const content = msg?.content || msg?.reasoning_content || "";
    return {
      content,
      inputTokens: data.usage?.prompt_tokens ?? estimateMessagesTokens(params.messages),
      outputTokens: data.usage?.completion_tokens ?? estimateTokens(content),
      model: data.model ?? params.model,
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const url = buildChatCompletionsUrl(this.normalizedBase);
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: true,
      stream_options: params.streamOptions ?? { include_usage: true },
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
    if (params.response_format) body.response_format = params.response_format;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildProviderHeaders(this.apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Chat stream request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body is not readable");

    const decoder = new TextDecoder();
    let buffer = "";
    let finalDoneEmitted = false;
    let lastInputTokens: number | undefined;
    let lastOutputTokens: number | undefined;
    let accumulatedContent = "";

    const STREAM_READ_TIMEOUT_MS = 120_000; // 2 min timeout per read

    try {
      while (true) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
            setTimeout(() => reject(new Error("Stream read timeout — LLM response stalled")), STREAM_READ_TIMEOUT_MS)
          ),
        ]);
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            if (!finalDoneEmitted) {
              yield {
                content: "",
                done: true,
                inputTokens: lastInputTokens ?? estimateMessagesTokens(params.messages),
                outputTokens: lastOutputTokens ?? estimateTokens(accumulatedContent),
              };
            }
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{
                delta: { content?: string; reasoning_content?: string };
                finish_reason: string | null;
              }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            const delta = parsed.choices[0]?.delta;
            const content = delta?.content ?? "";
            accumulatedContent += content;
            const chunk: ChatChunk = {
              content,
              done: parsed.choices[0]?.finish_reason != null || Boolean(parsed.usage),
            };
            if (delta?.reasoning_content) chunk.reasoning = delta.reasoning_content;
            if (parsed.usage) {
              chunk.inputTokens = parsed.usage.prompt_tokens;
              chunk.outputTokens = parsed.usage.completion_tokens;
              lastInputTokens = parsed.usage.prompt_tokens;
              lastOutputTokens = parsed.usage.completion_tokens;
            }
            if (chunk.done) {
              finalDoneEmitted = true;
              chunk.inputTokens = chunk.inputTokens ?? lastInputTokens ?? estimateMessagesTokens(params.messages);
              chunk.outputTokens = chunk.outputTokens ?? lastOutputTokens ?? estimateTokens(accumulatedContent);
            }
            yield chunk;
          } catch {
            console.warn("Skipped malformed SSE JSON line:", line.slice(0, 200));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      content: "",
      done: true,
      inputTokens: lastInputTokens ?? estimateMessagesTokens(params.messages),
      outputTokens: lastOutputTokens ?? estimateTokens(accumulatedContent),
    };
  }

  async embed(texts: string[], model?: string, dimensions?: number): Promise<EmbedResponse> {
    const url = buildEmbeddingsUrl(this.normalizedBase);
    const body: Record<string, unknown> = { input: texts, model: model || "text-embedding" };
    if (dimensions) body.dimensions = dimensions;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildProviderHeaders(this.apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Embed request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens?: number };
    };

    return {
      embeddings: data.data.map((item) => item.embedding),
      inputTokens: data.usage?.prompt_tokens ?? estimateTokens(texts.join("\n")),
    };
  }

  async testConnection(): Promise<boolean> {
    const headers = buildProviderHeaders(this.apiKey);
    for (const path of ["/v1/models", "/models"]) {
      try {
        const response = await fetchWithTimeout(`${this.normalizedBase}${path}`, { method: "GET", headers });
        if (response.ok) return true;
      } catch { /* continue */ }
    }
    try {
      const response = await fetchWithTimeout(buildEmbeddingsUrl(this.normalizedBase), {
        method: "POST",
        headers,
        body: JSON.stringify({ input: "test", model: "test" }),
      });
      if (response.ok || response.status === 400 || response.status === 404) return true;
    } catch { /* ignore */ }
    return false;
  }

  async getModels(): Promise<ModelInfo[]> {
    const url = buildModelsUrl(this.normalizedBase);
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: buildProviderHeaders(this.apiKey),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Get models failed (${response.status}): ${errorText || response.statusText}`);
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
