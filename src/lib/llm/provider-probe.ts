import { normalizeProviderBaseUrl, buildProviderHeaders } from "@/lib/llm/provider-endpoints";

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
      const data = await res.json() as { data?: Array<{ embedding: number[] }> };
      const dim = data.data?.[0]?.embedding?.length;
      return dim && dim > 0 ? dim : null;
    }
    return null;
  };

  for (const url of [actualBase, normalizedBase]) {
    for (const dim of [1536, 1024, 768]) {
      const result = await tryProbe(url, { input: ["dimension probe"], model: model.modelId, dimensions: dim });
      if (result === dim) return dim;
    }
    const nativeDim = await tryProbe(url, { input: ["dimension probe"], model: model.modelId });
    if (nativeDim) return nativeDim;
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

  for (const url of [actualBase, normalizedBase]) {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST", headers,
        body: JSON.stringify({ input: ["dimension probe"], model: model.modelId, dimensions: expectedDim }),
      });
      if (res.ok) {
        const data = await res.json() as { data?: Array<{ embedding: number[] }> };
        if (data.data?.[0]?.embedding?.length === expectedDim) return true;
      }
    } catch {}
  }
  return false;
}
