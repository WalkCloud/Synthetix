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
  validateEmbeddingDim,
} from "@/lib/llm/provider-probe";

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

    const embedModels = provider.models.filter((m) => {
      const caps = parseCapabilities(m.capabilities);
      return caps.some((c) => c === "embedding" || c === "embed");
    });
    const embeddingDims: Record<string, number> = {};
    const embedDimErrors: string[] = [];
    for (const m of embedModels) {
      if (m.embeddingDim && m.embeddingDim > 0) {
        const valid = await validateEmbeddingDim(baseUrl, headers, { modelId: m.modelId }, provider.apiBaseUrl, m.embeddingDim);
        if (valid) {
          embeddingDims[m.modelId] = m.embeddingDim;
        } else {
          embedDimErrors.push(`${m.modelId}: specified dimension ${m.embeddingDim} not accepted by API`);
        }
      } else {
        const dim = await detectEmbeddingDim(baseUrl, headers, { modelId: m.modelId }, provider.apiBaseUrl);
        if (dim !== null) {
          embeddingDims[m.modelId] = dim;
          await db.modelConfig.update({ where: { id: m.id }, data: { embeddingDim: dim } }).catch(() => {});
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
