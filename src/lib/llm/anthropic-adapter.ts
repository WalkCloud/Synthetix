import type {
  ChatChunk,
  ChatParams,
  ChatResponse,
  EmbedResponse,
  LLMProvider,
  ModelInfo,
} from "./types";
import type { ChatMessage } from "./types";
import { computeBackoffMs, delay } from "./retry-after";
import { getLimiter, type AdaptiveLimiter } from "./adaptive-limiter";
import { parseRateLimitHeaders, type RateLimitInfo } from "./rate-limit-headers";
import { FETCH_TIMEOUT_MS, STREAM_READ_TIMEOUT_MS } from "./env";

interface AdapterConfig {
  baseUrl: string;
  apiKey?: string;
  /** Per-provider key for the adaptive limiter. Omit to disable (tests). */
  providerKey?: string;
}

type ChatResponseWithRateLimit = ChatResponse & { rateLimit?: RateLimitInfo };

// Timeouts are env-configurable (LLM_FETCH_TIMEOUT_MS / LLM_STREAM_READ_TIMEOUT_MS);
// see ./env. Defaults preserve prior behaviour.
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1.5));
}

function estimateMessagesTokens(messages: { content: string }[]): number {
  return estimateTokens(messages.map((message) => message.content).join("\n"));
}

/** Strip trailing slashes and any accidentally appended /v1/messages suffix. */
function normalizeAnthropicBase(url: string): string {
  return url
    .replace(/\/+$/, "")
    .replace(/\/v1\/messages$/, "")
    .replace(/\/messages$/, "");
}

function buildMessagesUrl(base: string): string {
  return `${normalizeAnthropicBase(base)}/v1/messages`;
}

function buildModelsUrl(base: string): string {
  return `${normalizeAnthropicBase(base)}/v1/models`;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

/**
 * Anthropic's Messages API does not accept a `system` entry inside the
 * messages array — the system prompt must be a top-level `system` field.
 * This splits the OpenAI-style messages into { system, messages }.
 */
function splitSystemMessage(messages: ChatMessage[]): {
  system?: string;
  messages: ChatMessage[];
} {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = messages.filter((m) => m.role !== "system");
  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: rest,
  };
}

export class AnthropicAdapter implements LLMProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  /** Resolved lazily on first use so the constructor stays sync. */
  private limiterPromise: Promise<AdaptiveLimiter | null> | null = null;
  /** Cached after first await for sync access from the retry loop. */
  private limiter: AdaptiveLimiter | null = null;

  constructor(config: AdapterConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    if (config.providerKey) {
      this.limiterPromise = getLimiter(config.providerKey).then((l) => {
        this.limiter = l;
        return l;
      });
    }
  }

  /** Same anti-thundering-herd hook as the OpenAI adapter. Best-effort. */
  private notifyLimiterRateLimited(headers: Headers | null): void {
    if (!this.limiter) return;
    try {
      const rateLimit = headers ? parseRateLimitHeaders(headers) : undefined;
      void this.limiter.notifyRateLimited(rateLimit);
    } catch (err) {
      console.warn("[llm] failed to notify limiter of rate-limit:", err);
    }
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const limiter = this.limiterPromise ? await this.limiterPromise : null;
    const est = estimateMessagesTokens(params.messages) + (params.maxTokens ?? DEFAULT_MAX_TOKENS);
    const release = limiter ? await limiter.acquire({ estimatedTokens: est }) : null;
    const started = Date.now();
    try {
      const res = await this.chatWithRetry(params, 3);
      if (release) {
        void release({
          status: 200,
          actualTokens: res.inputTokens + res.outputTokens,
          latencyMs: Date.now() - started,
          rateLimit: res.rateLimit,
        });
      }
      return res;
    } catch (err) {
      if (release) {
        const is429 = err instanceof Error && /429|503|rate limit|overload/i.test(err.message);
        void release(
          is429 ? { status: 429, actualTokens: est, latencyMs: Date.now() - started } : undefined,
        );
      }
      throw err;
    }
  }

  private async chatWithRetry(params: ChatParams, remaining: number): Promise<ChatResponseWithRateLimit> {
    const url = buildMessagesUrl(this.baseUrl);
    const { system, messages } = splitSystemMessage(params.messages);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: false,
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (system) body.system = system;
    // Anthropic has no OpenAI-style response_format; we deliberately omit it.
    // Callers rely on their own JSON parsing (consistent with the OpenAI
    // adapter's graceful-degradation behavior).

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method: "POST",
        headers: buildHeaders(this.apiKey),
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network failure / DNS error / timeout — retryable. A transient blip
      // must not sink a long-running multi-step pipeline.
      if (remaining > 0) {
        await delay(computeBackoffMs(null, remaining));
        return this.chatWithRetry(params, remaining - 1);
      }
      throw new Error(`Chat request failed (network): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      if (response.status === 429 || response.status === 503) {
        this.notifyLimiterRateLimited(response.headers);
      }
      if (retryable && remaining > 0) {
        await delay(computeBackoffMs(response.headers.get("retry-after"), remaining));
        return this.chatWithRetry(params, remaining - 1);
      }
      throw new Error(`Chat request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
      stop_reason?: string | null;
    };

    const content =
      (data.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("") || "";

    return {
      content,
      inputTokens: data.usage?.input_tokens ?? estimateMessagesTokens(params.messages),
      outputTokens: data.usage?.output_tokens ?? estimateTokens(content),
      model: data.model ?? params.model,
      finishReason: data.stop_reason ?? undefined,
      rateLimit: parseRateLimitHeaders(response.headers),
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const limiter = this.limiterPromise ? await this.limiterPromise : null;
    const est = estimateMessagesTokens(params.messages) + (params.maxTokens ?? DEFAULT_MAX_TOKENS);
    const release = limiter ? await limiter.acquire({ estimatedTokens: est }) : null;
    const started = Date.now();
    let lastInputTokens: number | undefined;
    let lastOutputTokens: number | undefined;
    let failed = false;
    try {
      const generator = this.chatStreamWithRetry(params, 3);
      for await (const chunk of generator) {
        if (chunk.inputTokens !== undefined) lastInputTokens = chunk.inputTokens;
        if (chunk.outputTokens !== undefined) lastOutputTokens = chunk.outputTokens;
        yield chunk;
      }
    } catch (err) {
      failed = true;
      if (release) {
        const is429 = err instanceof Error && /429|503|rate limit|overload/i.test(err.message);
        void release(
          is429 ? { status: 429, actualTokens: est, latencyMs: Date.now() - started } : undefined,
        );
      }
      throw err;
    } finally {
      if (release && !failed) {
        const actual = (lastInputTokens ?? est) + (lastOutputTokens ?? 0);
        void release({ status: 200, actualTokens: actual, latencyMs: Date.now() - started });
      }
    }
  }

  private async *chatStreamWithRetry(params: ChatParams, remaining: number): AsyncGenerator<ChatChunk> {
    const url = buildMessagesUrl(this.baseUrl);
    const { system, messages } = splitSystemMessage(params.messages);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (system) body.system = system;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (response.status === 429 || response.status === 503) {
        this.notifyLimiterRateLimited(response.headers);
      }
      if (retryable && remaining > 0) {
        await delay(computeBackoffMs(response.headers.get("retry-after"), remaining));
        const retry = this.chatStreamWithRetry(params, remaining - 1);
        for await (const chunk of retry) {
          yield chunk;
        }
        return;
      }
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

    try {
      while (true) {
        // Race each read against a stall timeout, clearing the timer on the
        // success path so a long stream doesn't leak one handle per chunk.
        let stallTimer: ReturnType<typeof setTimeout> | undefined;
        const readResult = await Promise.race([
          reader.read(),
          new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
            stallTimer = setTimeout(
              () => reject(new Error("Stream read timeout — LLM response stalled")),
              STREAM_READ_TIMEOUT_MS,
            );
          }),
        ]).finally(() => {
          if (stallTimer) clearTimeout(stallTimer);
        });
        const { done, value } = readResult;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          // Anthropic has no [DONE] sentinel; the terminal event is message_stop.
          try {
            const parsed = JSON.parse(data) as {
              type: string;
              message?: { usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
              delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string | null };
              usage?: { input_tokens?: number; output_tokens?: number };
            };

            switch (parsed.type) {
              case "message_start": {
                lastInputTokens = parsed.message?.usage?.input_tokens;
                lastOutputTokens = parsed.message?.usage?.output_tokens;
                break;
              }
              case "content_block_delta": {
                const delta = parsed.delta;
                if (delta?.type === "text_delta" && typeof delta.text === "string") {
                  accumulatedContent += delta.text;
                  yield { content: delta.text, done: false };
                } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
                  yield { content: "", reasoning: delta.thinking, done: false };
                }
                break;
              }
              case "message_delta": {
                if (parsed.usage?.output_tokens !== undefined) {
                  lastOutputTokens = parsed.usage.output_tokens;
                }
                if (parsed.usage?.input_tokens !== undefined) {
                  lastInputTokens = parsed.usage.input_tokens;
                }
                break;
              }
              case "message_stop": {
                if (!finalDoneEmitted) {
                  finalDoneEmitted = true;
                  yield {
                    content: "",
                    done: true,
                    inputTokens: lastInputTokens ?? estimateMessagesTokens(params.messages),
                    outputTokens: lastOutputTokens ?? estimateTokens(accumulatedContent),
                  };
                }
                break;
              }
              default:
                // ping, content_block_start/stop, etc. — no action needed.
                break;
            }
          } catch {
            console.warn("Skipped malformed Anthropic SSE JSON line:", line.slice(0, 200));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Safety net: if the stream ended without a message_stop carrying usage,
    // emit a terminal chunk so consumers always receive done:true with counts.
    if (!finalDoneEmitted) {
      yield {
        content: "",
        done: true,
        inputTokens: lastInputTokens ?? estimateMessagesTokens(params.messages),
        outputTokens: lastOutputTokens ?? estimateTokens(accumulatedContent),
      };
    }
  }

  async embed(): Promise<EmbedResponse> {
    // Anthropic offers no embeddings endpoint, and the app routes embedding
    // strictly to embedding-capable models (never to a chat/Anthropic model),
    // so this method is never exercised in practice.
    throw new Error("Anthropic does not support embeddings");
  }

  async testConnection(): Promise<boolean> {
    const headers = buildHeaders(this.apiKey);
    for (const path of ["/v1/models", "/models"]) {
      try {
        const response = await fetchWithTimeout(`${normalizeAnthropicBase(this.baseUrl)}${path}`, {
          method: "GET",
          headers,
        });
        if (response.ok) return true;
      } catch {
        /* continue */
      }
    }
    // Some Anthropic-compatible gateways (e.g. Volcengine) may not expose
    // /models. A 401/403 here still means the endpoint is reachable.
    try {
      const response = await fetchWithTimeout(buildMessagesUrl(this.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "test", max_tokens: 1, messages: [{ role: "user", content: "." }] }),
      });
      if (response.ok || response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  async getModels(): Promise<ModelInfo[]> {
    const url = buildModelsUrl(this.baseUrl);
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: buildHeaders(this.apiKey),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Get models failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ id: string; type?: string; object?: string; display_name?: string }>;
    };

    return data.data.map((model) => ({
      id: model.id,
      name: model.display_name ?? model.id,
      type: model.type ?? model.object ?? "model",
    }));
  }
}
