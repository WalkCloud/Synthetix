import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";
import { parseCapabilities } from "@/lib/llm/capabilities";

function normalizeBaseUrl(url: string): string {
  return url
    .replace(/\/+$/, "")
    .replace(/\/v\d+\/(chat\/completions|embeddings)(\/\w+)?$/, "")
    .replace(/\/v\d+$/, "");
}

async function detectContextWindows(
  baseUrl: string,
  ver: string,
  headers: Record<string, string>,
  models: Array<{ id: string; modelId: string }>,
  providerType: string,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  for (const model of models) {
    // Ollama: /api/show returns model_info with context_length
    if (providerType === "ollama") {
      try {
        const showRes = await fetch(`${baseUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model.modelId }),
        });
        if (showRes.ok) {
          const data = (await showRes.json()) as {
            model_info?: Record<string, unknown>;
          };
          const modelInfo = data.model_info ?? {};
          for (const [key, value] of Object.entries(modelInfo)) {
            if (key.endsWith(".context_length") && typeof value === "number") {
              result[model.modelId] = value;
              break;
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Check /v1/models for context info (some providers include it)
    if (!result[model.modelId]) {
      try {
        const modelsRes = await fetch(`${baseUrl}${ver}/models`, {
          method: "GET",
          headers,
        });
        if (modelsRes.ok) {
          const data = (await modelsRes.json()) as {
            data?: Array<Record<string, unknown>>;
          };
          const entry = (data.data ?? []).find(
            (m) => m.id === model.modelId,
          );
          if (entry) {
            const ctx =
              entry.context_window ??
              entry.context_length ??
              entry.max_context_length ??
              entry.max_model_len;
            if (typeof ctx === "number") {
              result[model.modelId] = ctx;
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  return result;
}

async function detectEmbeddingDim(
  baseUrl: string,
  headers: Record<string, string>,
  model: { id: string; modelId: string },
  originalUrl: string,
): Promise<number | null> {
  // Build probe URLs: try actual endpoint first, then normalized
  const actualBase = originalUrl.replace(/\/+$/, "").replace(/\/embeddings(\/\w+)?$/, "/embeddings");
  const verMatch = originalUrl.match(/\/v(\d+)\//);
  const normalizedBase = `${baseUrl}${verMatch ? `/v${verMatch[1]}` : "/v1"}/embeddings`;

  const probeUrls = [actualBase, normalizedBase];

  const tryProbe = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.ok) {
      const data = await res.json() as { data?: Array<{ embedding: number[] }> };
      const dim = data.data?.[0]?.embedding?.length;
      if (dim && dim > 0) return dim;
    }
    return null;
  };

  for (const url of probeUrls) {
    let dim = await tryProbe(url, { input: ["dimension probe"], model: model.modelId, dimensions: 1536 });
    if (dim) return dim;
    dim = await tryProbe(url, { input: ["dimension probe"], model: model.modelId });
    if (dim) return dim;
  }
  return null;
}

async function validateEmbeddingDim(
  baseUrl: string,
  headers: Record<string, string>,
  model: { id: string; modelId: string },
  originalUrl: string,
  expectedDim: number,
): Promise<boolean> {
  const actualBase = originalUrl.replace(/\/+$/, "").replace(/\/embeddings(\/\w+)?$/, "/embeddings");
  const verMatch = originalUrl.match(/\/v(\d+)\//);
  const normalizedBase = `${baseUrl}${verMatch ? `/v${verMatch[1]}` : "/v1"}/embeddings`;

  for (const url of [actualBase, normalizedBase]) {
    try {
      const res = await fetch(url, {
        method: "POST", headers,
        body: JSON.stringify({ input: ["dimension probe"], model: model.modelId, dimensions: expectedDim }),
      });
      if (res.ok) {
        const data = await res.json() as { data?: Array<{ embedding: number[] }> };
        const dim = data.data?.[0]?.embedding?.length;
        if (dim === expectedDim) return true;
      }
    } catch { /* try next URL */ }
  }
  return false;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );

  const { id } = await params;
  const provider = await db.modelProvider.findFirst({
    where: { id, userId: user.id },
    include: { models: true },
  });

  if (!provider) {
    return NextResponse.json(
      { success: false, error: "Provider not found" },
      { status: 404 },
    );
  }

  try {
    const baseUrl = normalizeBaseUrl(provider.apiBaseUrl);
    // Extract version prefix from original URL (e.g. /v3/ from /v3/embeddings/multimodal)
    const verMatch = provider.apiBaseUrl.match(/\/v(\d+)\//);
    const ver = verMatch ? `/v${verMatch[1]}` : "/v1";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${decrypt(provider.apiKey)}`;
    }

    // Test connection via /v1/models
    let connected = false;
    const modelsRes = await fetch(`${baseUrl}${ver}/models`, {
      method: "GET",
      headers,
    });
    if (modelsRes.ok) {
      connected = true;
    }

    // Fallback: try embed endpoint to verify connectivity/auth
    if (!connected) {
      const embedRes = await fetch(`${baseUrl}${ver}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: "test", model: "test" }),
      });
      if (embedRes.ok || embedRes.status === 400 || embedRes.status === 404) {
        connected = true;
      } else {
        const errorText = await embedRes.text().catch(() => "");
        return NextResponse.json({
          success: true,
          data: {
            connected: false,
            error: `${embedRes.status}: ${errorText.slice(0, 200)}`,
          },
        });
      }
    }

    // Auto-detect context windows from provider API
    const contextWindows = await detectContextWindows(
      baseUrl, ver,
      headers,
      provider.models.map((m) => ({ id: m.id, modelId: m.modelId })),
      provider.providerType,
    );

    // Persist detected context windows
    for (const [externalModelId, ctx] of Object.entries(contextWindows)) {
      const config = provider.models.find(
        (m) => m.modelId === externalModelId,
      );
      if (config) {
        await db.modelConfig.update({
          where: { id: config.id },
          data: { contextWindow: ctx },
        });
      }
    }

    // Auto-detect embedding dimensions for embedding models
    const embedModels = provider.models.filter((m) => {
      const caps = parseCapabilities(m.capabilities);
      return caps.some((c) => c === "embedding" || c === "embed");
    });
    const embeddingDims: Record<string, number> = {};
    const embedDimErrors: string[] = [];
    for (const m of embedModels) {
      // Manual dimension specified: validate against API
      if (m.embeddingDim && m.embeddingDim > 0) {
        const valid = await validateEmbeddingDim(baseUrl, headers, { id: m.id, modelId: m.modelId }, provider.apiBaseUrl, m.embeddingDim);
        if (valid) {
          embeddingDims[m.modelId] = m.embeddingDim;
        } else {
          embedDimErrors.push(`${m.modelId}: specified dimension ${m.embeddingDim} not accepted by API`);
        }
      } else {
        // Auto-detect
        const dim = await detectEmbeddingDim(baseUrl, headers, { id: m.id, modelId: m.modelId }, provider.apiBaseUrl);
        if (dim !== null) {
          embeddingDims[m.modelId] = dim;
          await db.modelConfig.update({
            where: { id: m.id },
            data: { embeddingDim: dim },
          }).catch(() => {});
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { connected: true, contextWindows, embeddingDims, embedDimErrors: embedDimErrors.length > 0 ? embedDimErrors : undefined },
    });
  } catch (err) {
    return NextResponse.json({
      success: true,
      data: {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
