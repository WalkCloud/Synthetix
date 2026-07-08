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
import { computeBackoffMs, delay, isBalanceExhausted } from "./retry-after";
import { parseRateLimitHeaders, type RateLimitInfo } from "./rate-limit-headers";
import { getLimiter, type AdaptiveLimiter } from "./adaptive-limiter";
import {
  FETCH_TIMEOUT_MS,
  EMBED_FETCH_TIMEOUT_MS,
  STREAM_READ_TIMEOUT_MS,
} from "./env";
import { fetchWithTimeout as fetchWithTimeoutRaw, estimateTokens } from "./http";

interface AdapterConfig {
  baseUrl: string;
  apiKey?: string;
  /**
   * Per-provider key for the adaptive limiter (see adaptive-limiter.ts).
   * When provided, chat/embed/chatStream acquire capacity before each call
   * and release it with the response's rate-limit headers, so the limiter
   * learns the provider's true ceiling. Omit to disable limiting (tests).
   */
  providerKey?: string;
}

type ChatResponseWithRateLimit = ChatResponse & { rateLimit?: RateLimitInfo };
type EmbedResponseWithRateLimit = EmbedResponse & { rateLimit?: RateLimitInfo };

// Timeouts are env-configurable via LLM_FETCH_TIMEOUT_MS / LM_EMBED_TIMEOUT_MS /
// LLM_STREAM_READ_TIMEOUT_MS (see ./env). Defaults preserve prior behaviour.

/** Adapter-local wrapper that defaults to FETCH_TIMEOUT_MS. */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  return fetchWithTimeoutRaw(url, init, timeoutMs);
}

function estimateMessagesTokens(messages: ChatParams["messages"]): number {
  return estimateTokens(messages.map((message) => message.content).join("\n"));
}

export class OpenAICompatibleAdapter implements LLMProvider {
  private readonly normalizedBase: string;
  private readonly apiKey?: string;
  /** Resolved lazily on first use so the constructor stays sync. */
  private limiterPromise: Promise<AdaptiveLimiter | null> | null = null;
  /** Resolved limiter instance, cached after first await for sync access
   *  from the retry loop (notifyRateLimited on a mid-retry 429). */
  private limiter: AdaptiveLimiter | null = null;

  constructor(config: AdapterConfig) {
    this.normalizedBase = normalizeProviderBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    if (config.providerKey) {
      // Lazily fetch the shared limiter for this provider. Memoised so all
      // calls on this adapter share one instance.
      this.limiterPromise = getLimiter(config.providerKey).then((l) => {
        this.limiter = l;
        return l;
      });
    }
  }

  /**
   * Notify the limiter of a 429/503 the instant we see it (inside the retry
   * loop), so it can trigger single-flight cooldown for ALL callers on this
   * provider before sibling requests pile into the same wall. This is the
   * anti-thundering-herd / anti-ban measure. Best-effort: never throws.
   */
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
    const est = estimateMessagesTokens(params.messages) + (params.maxTokens ?? 1024);
    const release = limiter ? await limiter.acquire({ estimatedTokens: est }) : null;
    const started = Date.now();
    try {
      const res = await this.chatWithRetry(params, 3);
      // Feed the success outcome (status 200, real token counts) back to the
      // limiter so it can grow the budget (slow-start / additive increase).
      if (release) {
        const actual = res.inputTokens + res.outputTokens;
        void release({ status: 200, actualTokens: actual, latencyMs: Date.now() - started, rateLimit: res.rateLimit });
      }
      return res;
    } catch (err) {
      // On failure we still release capacity. If the failure was a 429 that
      // exhausted retries, signal it so the limiter shrinks + cools down.
      if (release) {
        const is429 = err instanceof Error && /429|503|rate limit|overload/i.test(err.message);
        void release(
          is429
            ? { status: 429, actualTokens: est, latencyMs: Date.now() - started }
            : undefined,
        );
      }
      throw err;
    }
  }

  private async chatWithRetry(params: ChatParams, remaining: number): Promise<ChatResponseWithRateLimit> {
    const url = buildChatCompletionsUrl(this.normalizedBase);
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: false,
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
    if (params.response_format) body.response_format = params.response_format;

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method: "POST",
        headers: buildProviderHeaders(this.apiKey),
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network failure / DNS error / timeout — retryable. Mirrors the
      // embedWithRetry pattern: a transient network blip must not sink a
      // long-running multi-chunk pipeline (wiki synthesis, graph extraction).
      if (remaining > 0) {
        await delay(computeBackoffMs(null, remaining));
        return this.chatWithRetry(params, remaining - 1);
      }
      throw new Error(`Chat request failed (network): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");

      // Graceful degradation: some providers/models reject `response_format`
      // (e.g. Doubao returns 400 "json_object is not supported by this model").
      // Instead of forcing every caller to know which models support it, we
      // retry once WITHOUT response_format — the caller's prompt + the JSON
      // parser (safeJsonParse in wiki/generator) handle the looser output.
      // This keeps JSON mode for models that DO support it (OpenAI, etc.)
      // while not breaking on models that don't.
      if (
        response.status === 400 &&
        params.response_format &&
        /response_format/i.test(errorText) &&
        remaining > 0
      ) {
        console.warn(`[llm] Model ${params.model} rejected response_format; retrying without JSON mode.`);
        const { response_format: _drop, ...rest } = params;
        void _drop;
        return this.chatWithRetry(rest as ChatParams, 0);
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (response.status === 429 || response.status === 503) {
        // Notify the limiter IMMEDIATELY so sibling in-flight requests on the
        // same provider enter single-flight cooldown (anti-thundering-herd),
        // including the final failed attempt when no retry remains.
        this.notifyLimiterRateLimited(response.headers);
      }
      // Balance exhausted (insufficient_quota / billing / 余额不足) is NOT
      // retryable — no amount of waiting helps until the user tops up. Fail
      // fast with a clear message instead of capacityMode backoff (which would
      // stall the pipeline for up to 6h on a dead account).
      if (isBalanceExhausted(response.status, errorText)) {
        throw new Error(
          `Chat request failed: account balance/quota exhausted (${response.status}). ${errorText || "Please top up and retry."}`,
        );
      }
      if (retryable && remaining > 0) {
        // Honour the server's Retry-After if given — strict providers (Volcengine,
        // some OpenAI proxies) ban clients that ignore it and retry on their own
        // clock. Falls back to jittered exponential when no hint is present.
        // capacityMode: a 429/5xx here is a genuine capacity signal, so honour
        // a long Retry-After (up to 6h) instead of clamping to 5 min.
        await delay(computeBackoffMs(response.headers.get("retry-after"), remaining, Date.now(), { capacityMode: true }));
        return this.chatWithRetry(params, remaining - 1);
      }
      throw new Error(`Chat request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string; reasoning_content?: string }; finish_reason?: string | null }>;
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
      finishReason: data.choices[0]?.finish_reason ?? undefined,
      rateLimit: parseRateLimitHeaders(response.headers),
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const limiter = this.limiterPromise ? await this.limiterPromise : null;
    const est = estimateMessagesTokens(params.messages) + (params.maxTokens ?? 1024);
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

      // Graceful degradation: mirror chatWithRetry's response_format fallback.
      // Some providers/models reject `response_format` on the streaming endpoint
      // too (e.g. Doubao/火山方舟 returns 400 "json_object is not supported by
      // this model"). The non-stream chat() already retries without JSON mode;
      // chatStream must do the same or outline generation (which streams) fails
      // on these models even though wiki synthesis (non-stream) succeeds.
      if (
        response.status === 400 &&
        params.response_format &&
        /response_format/i.test(errorText) &&
        remaining > 0
      ) {
        console.warn(`[llm] Model ${params.model} rejected response_format on stream; retrying without JSON mode.`);
        const { response_format: _drop, ...rest } = params;
        void _drop;
        const retry = this.chatStreamWithRetry(rest as ChatParams, 0);
        for await (const chunk of retry) {
          yield chunk;
        }
        return;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (response.status === 429 || response.status === 503) {
        this.notifyLimiterRateLimited(response.headers);
      }
      // Balance exhausted is not retryable — fail fast (see chat() for rationale).
      if (isBalanceExhausted(response.status, errorText)) {
        throw new Error(
          `Chat stream request failed: account balance/quota exhausted (${response.status}). ${errorText || "Please top up and retry."}`,
        );
      }
      if (retryable && remaining > 0) {
        await delay(computeBackoffMs(response.headers.get("retry-after"), remaining, Date.now(), { capacityMode: true }));
        const retry = this.chatStreamWithRetry(params, remaining - 1);
        for await (const chunk of retry) {
          yield chunk;
        }
        return;
      }
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
        // Race each read against a stall timeout. The timer MUST be cleared on
        // the success path — otherwise every read leaks a pending setTimeout
        // handle for the lifetime of the stream (a long generation can emit
        // hundreds of chunks, so this leak compounds).
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
    const limiter = this.limiterPromise ? await this.limiterPromise : null;
    const est = estimateTokens(texts.join("\n")) + 64;
    const release = limiter ? await limiter.acquire({ estimatedTokens: est }) : null;
    const started = Date.now();
    try {
      const res = await this.embedWithRetry(texts, model, dimensions, 3);
      if (release) {
        void release({
          status: 200,
          actualTokens: res.inputTokens || est,
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

  private async embedWithRetry(
    texts: string[],
    model: string | undefined,
    dimensions: number | undefined,
    remaining: number,
  ): Promise<EmbedResponseWithRateLimit> {
    const url = buildEmbeddingsUrl(this.normalizedBase);
    const body: Record<string, unknown> = { input: texts, model: model || "text-embedding" };
    if (dimensions) body.dimensions = dimensions;

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method: "POST",
        headers: buildProviderHeaders(this.apiKey),
        body: JSON.stringify(body),
      }, EMBED_FETCH_TIMEOUT_MS);
    } catch (err) {
      // Network failure / timeout — retryable. A single dropped connection must
      // not sink the whole rag_embed_index batch and force a full re-embed.
      if (remaining > 0) {
        await delay(computeBackoffMs(null, remaining));
        return this.embedWithRetry(texts, model, dimensions, remaining - 1);
      }
      throw new Error(`Embed request failed (network): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      if (response.status === 429 || response.status === 503) {
        this.notifyLimiterRateLimited(response.headers);
      }
      // Balance exhausted is not retryable — fail fast (see chat() for rationale).
      if (isBalanceExhausted(response.status, errorText)) {
        throw new Error(
          `Embed request failed: account balance/quota exhausted (${response.status}). ${errorText || "Please top up and retry."}`,
        );
      }
      if (retryable && remaining > 0) {
        await delay(computeBackoffMs(response.headers.get("retry-after"), remaining, Date.now(), { capacityMode: true }));
        return this.embedWithRetry(texts, model, dimensions, remaining - 1);
      }
      throw new Error(`Embed request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens?: number };
    };

    return {
      embeddings: data.data.map((item) => item.embedding),
      inputTokens: data.usage?.prompt_tokens ?? estimateTokens(texts.join("\n")),
      rateLimit: parseRateLimitHeaders(response.headers),
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
