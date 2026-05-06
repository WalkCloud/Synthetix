import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";

function normalizeBaseUrl(url: string): string {
  return url
    .replace(/\/+$/, "")
    .replace(/\/v1\/(chat\/completions|embeddings?)$/, "")
    .replace(/\/v1$/, "");
}

async function detectContextWindows(
  baseUrl: string,
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
        const modelsRes = await fetch(`${baseUrl}/v1/models`, {
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${decrypt(provider.apiKey)}`;
    }

    // Test connection via /v1/models
    let connected = false;
    const modelsRes = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers,
    });
    if (modelsRes.ok) {
      connected = true;
    }

    // Fallback: try embed endpoint to verify connectivity/auth
    if (!connected) {
      const embedRes = await fetch(`${baseUrl}/v1/embeddings`, {
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
      baseUrl,
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

    return NextResponse.json({
      success: true,
      data: { connected: true, contextWindows },
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
