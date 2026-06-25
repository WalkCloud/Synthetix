import { normalizeProviderBaseUrl } from "@/lib/llm/provider-endpoints";

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeBaseUrl(url: string): string {
  return normalizeProviderBaseUrl(url);
}

export function extractVersionPrefix(url: string): string {
  const verMatch = url.match(/\/v(\d+)\//);
  return verMatch ? `/v${verMatch[1]}` : "/v1";
}

export async function testConnectivity(
  baseUrl: string,
  ver: string,
  headers: Record<string, string>,
): Promise<{ connected: boolean; error?: string }> {
  const modelsRes = await fetchWithTimeout(`${baseUrl}${ver}/models`, {
    method: "GET",
    headers,
  });
  if (modelsRes.ok) return { connected: true };

  const embedRes = await fetchWithTimeout(`${baseUrl}${ver}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: "test", model: "test" }),
  });
  if (embedRes.ok || embedRes.status === 400 || embedRes.status === 404) {
    return { connected: true };
  }
  const errorText = await embedRes.text().catch(() => "");
  return { connected: false, error: `${embedRes.status}: ${errorText.slice(0, 200)}` };
}

export async function detectContextWindows(
  baseUrl: string,
  ver: string,
  headers: Record<string, string>,
  models: Array<{ id: string; modelId: string }>,
  providerType: string,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  for (const model of models) {
    if (providerType === "ollama") {
      try {
        const showRes = await fetchWithTimeout(`${baseUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model.modelId }),
        });
        if (showRes.ok) {
          const data = (await showRes.json()) as { model_info?: Record<string, unknown> };
          const modelInfo = data.model_info ?? {};
          for (const [key, value] of Object.entries(modelInfo)) {
            if (key.endsWith(".context_length") && typeof value === "number") {
              result[model.modelId] = value;
              break;
            }
          }
        }
      } catch {}
    }

    if (!result[model.modelId]) {
      try {
        const modelsRes = await fetchWithTimeout(`${baseUrl}${ver}/models`, {
          method: "GET",
          headers,
        });
        if (modelsRes.ok) {
          const data = (await modelsRes.json()) as { data?: Array<Record<string, unknown>> };
          const entry = (data.data ?? []).find((m) => m.id === model.modelId);
          if (entry) {
            const ctx =
              entry.context_window ??
              entry.context_length ??
              entry.max_context_length ??
              entry.max_model_len;
            if (typeof ctx === "number") result[model.modelId] = ctx;
          }
        }
      } catch {}
    }
  }

  return result;
}

/**
 * Extract embedding dimension from a JSON response body using any known
 * provider format (OpenAI, Dashscope, etc).  Returns the dimension if found,
 * null if the response does not contain a parseable embedding vector.
 */
function extractEmbeddingDim(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  // OpenAI / openai-compatible  { data: [{ embedding: [...] }] }
  const dataArr = Array.isArray(obj["data"]) ? obj["data"] : null;
  if (dataArr && dataArr.length > 0) {
    const emb = (dataArr[0] as Record<string, unknown>)["embedding"];
    if (Array.isArray(emb) && emb.length > 0) return emb.length;
  }

  // Dashscope  { output: { embeddings: [{ embedding: [...] }] } }
  const output = obj["output"] as Record<string, unknown> | undefined;
  if (output) {
    const embeddings = Array.isArray(output["embeddings"]) ? output["embeddings"] : null;
    if (embeddings && embeddings.length > 0) {
      const emb = (embeddings[0] as Record<string, unknown>)["embedding"];
      if (Array.isArray(emb) && emb.length > 0) return emb.length;
    }
  }

  // Deep recursive scan — walk the object tree looking for the first
  // array property named "embedding" with numeric elements
  const scan = (val: unknown): number | null => {
    if (!val || typeof val !== "object") return null;
    const o = val as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (k === "embedding" && Array.isArray(v) && v.length > 0 && typeof v[0] === "number") {
        return v.length;
      }
      const found = scan(v);
      if (found) return found;
    }
    return null;
  };
  return scan(data);
}

/**
 * Build a list of request bodies to try for embedding dimension detection.
 * Different providers expect different input formats.
 */
function embeddingProbeBodies(
  modelId: string,
  dimensions?: number,
): Array<Record<string, unknown>> {
  const base = { model: modelId, ...(dimensions ? { dimensions } : {}) };
  return [
    // OpenAI-compatible:  { input: ["text"], model: "..." }
    { ...base, input: ["dimension probe"] },
    // Multimodal volcengine: { input: [{ type: "text", text: "..." }], model: "..." }
    { ...base, input: [{ type: "text", text: "dimension probe" }] },
    // Dashscope native multimodal: { input: { contents: [{ text: "..." }] }, model: "..." }
    { ...base, input: { contents: [{ text: "dimension probe" }] } },
  ];
}

/** Well-known embedding endpoints that don't follow the standard URL pattern. */
const FALLBACK_ENDPOINTS = [
  "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding",
];

export async function detectEmbeddingDim(
  baseUrl: string,
  headers: Record<string, string>,
  model: { modelId: string },
  originalUrl: string,
): Promise<number | null> {
  const actualBase = originalUrl.replace(/\/+$/, "").replace(/\/embeddings(\/\w+)?$/, "/embeddings");
  const verMatch = originalUrl.match(/\/v(\d+)\//);
  const normalizedBase = `${baseUrl}${verMatch ? `/v${verMatch[1]}` : "/v1"}/embeddings`;

  const tryProbe = async (url: string, body: Record<string, unknown>) => {
    const res = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.ok) {
      const data = await res.json();
      return extractEmbeddingDim(data);
    }
    return null;
  };

  // Derived URLs + original + well-known fallbacks.
  // The originalUrl is included because normalizeProviderBaseUrl may strip
  // endpoint-specific path segments (e.g. /embeddings/multimodal → /embeddings).
  const urls = [actualBase, normalizedBase, originalUrl, ...FALLBACK_ENDPOINTS];

  // Candidate dimensions probed largest-first. The goal is to find the
  // MAXIMUM dimension the model genuinely supports, not a downgraded default.
  // 2048 is included because many providers (Volcengine doubao, Dashscope v4)
  // support it as the top end even though their no-arg default is smaller.
  const DIMENSION_CANDIDATES = [3072, 2048, 1536, 1024, 768];

  for (const url of urls) {
    // 1. Probe from the LARGEST dimension down, requiring an EXACT match.
    //    Exact-match is essential: some providers (e.g. Dashscope v4) silently
    //    downgrade an oversized `dimensions` request instead of erroring — so
    //    "request 3072 → got 2048" must NOT be accepted as 3072. Only a request
    //    that returns exactly the requested dim counts as "supported", and the
    //    first (largest) such match is the model's true maximum.
    for (const dim of DIMENSION_CANDIDATES) {
      for (const body of embeddingProbeBodies(model.modelId, dim)) {
        const result = await tryProbe(url, body);
        if (result === dim) return dim;
      }
    }
    // 2. Fallback: native default dimension (no `dimensions` param).
    //    Only reached if NO candidate returned an exact match — i.e. the model
    //    does not honor the `dimensions` param at all (legacy/local models).
    //    A non-exact positive result here is still better than nothing.
    for (const body of embeddingProbeBodies(model.modelId)) {
      const nativeDim = await tryProbe(url, body);
      if (nativeDim && nativeDim > 0) return nativeDim;
    }
  }
  return null;
}

export async function validateEmbeddingDim(
  baseUrl: string,
  headers: Record<string, string>,
  model: { modelId: string },
  originalUrl: string,
  expectedDim: number,
): Promise<boolean> {
  const actualBase = originalUrl.replace(/\/+$/, "").replace(/\/embeddings(\/\w+)?$/, "/embeddings");
  const verMatch = originalUrl.match(/\/v(\d+)\//);
  const normalizedBase = `${baseUrl}${verMatch ? `/v${verMatch[1]}` : "/v1"}/embeddings`;

  for (const url of [actualBase, normalizedBase, originalUrl, ...FALLBACK_ENDPOINTS]) {
    for (const body of embeddingProbeBodies(model.modelId, expectedDim)) {
      try {
        const res = await fetchWithTimeout(url, {
          method: "POST", headers,
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          if (extractEmbeddingDim(data) === expectedDim) return true;
        }
      } catch {}
    }
  }
  return false;
}
