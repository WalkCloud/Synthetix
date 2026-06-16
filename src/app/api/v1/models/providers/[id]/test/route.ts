import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";
import { parseCapabilities } from "@/lib/llm/capabilities";
import {
  normalizeBaseUrl,
  extractVersionPrefix,
  testConnectivity,
  detectContextWindows,
  detectEmbeddingDim,
} from "@/lib/llm/provider-probe";
import { lookupEmbeddingDim, lookupContextWindow, lookupMaxOutputTokens } from "@/lib/models/model-catalog";

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
    const ver = extractVersionPrefix(provider.apiBaseUrl);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${decrypt(provider.apiKey)}`;
    }

    const conn = await testConnectivity(baseUrl, ver, headers);
    if (!conn.connected) {
      return NextResponse.json({ success: true, data: { connected: false, error: conn.error } });
    }

    const contextWindows = await detectContextWindows(
      baseUrl, ver, headers,
      provider.models.map((m) => ({ id: m.id, modelId: m.modelId })),
      provider.providerType,
    );

    for (const [externalModelId, ctx] of Object.entries(contextWindows)) {
      const config = provider.models.find((m) => m.modelId === externalModelId);
      if (config) {
        await db.modelConfig.update({ where: { id: config.id }, data: { contextWindow: ctx } });
      }
    }
    // Catalog fallback for models whose context window wasn't auto-detected
    for (const m of provider.models) {
      if ((m.contextWindow ?? 0) === 0 && !contextWindows[m.modelId]) {
        const ctx = await lookupContextWindow(m.modelId);
        if (ctx > 0) {
          contextWindows[m.modelId] = ctx;
          await db.modelConfig.update({ where: { id: m.id }, data: { contextWindow: ctx } }).catch(() => {});
        }
      }
    }
    // Catalog fallback for max output tokens
    for (const m of provider.models) {
      if (!m.maxOutputTokens) {
        const mot = await lookupMaxOutputTokens(m.modelId);
        if (mot) {
          await db.modelConfig.update({ where: { id: m.id }, data: { maxOutputTokens: mot } }).catch(() => {});
        }
      }
    }

    const embedModels = provider.models.filter((m) => {
      const caps = parseCapabilities(m.capabilities);
      return caps.some((c) => c === "embedding" || c === "embed");
    });
    const embeddingDims: Record<string, number> = {};
    const embedDimErrors: string[] = [];
    for (const m of embedModels) {
      const dim = await detectEmbeddingDim(baseUrl, headers, { modelId: m.modelId }, provider.apiBaseUrl);
      if (dim !== null) {
        embeddingDims[m.modelId] = dim;
        await db.modelConfig.update({ where: { id: m.id }, data: { embeddingDim: dim } }).catch(() => {});
      } else {
        // Fallback to LiteLLM catalog
        const catalogDim = await lookupEmbeddingDim(m.modelId);
        if (catalogDim) {
          embeddingDims[m.modelId] = catalogDim;
          await db.modelConfig.update({ where: { id: m.id }, data: { embeddingDim: catalogDim } }).catch(() => {});
        } else {
          embedDimErrors.push(`${m.modelId}: unable to detect embedding dimension`);
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
      data: { connected: false, error: err instanceof Error ? err.message : String(err) },
    });
  }
}
