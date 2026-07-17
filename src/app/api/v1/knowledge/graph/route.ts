import { getAuthUser } from "@/lib/auth/session";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import { getCachedGraph, setCachedGraph } from "@/lib/knowledge/graph-cache";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { searchParams } = new URL(request.url);
  const entityName = searchParams.get("entity") || "";
  const depth = parseInt(searchParams.get("depth") || "3", 10);
  const maxNodes = parseInt(searchParams.get("max_nodes") || "200", 10);
  const mode = searchParams.get("mode") || "core";
  const minDegree = parseInt(searchParams.get("min_degree") || "1", 10);

  // Cache hit short-circuits the expensive Python fan-out + DB model resolution.
  const cacheParams = { entityName: entityName, depth, maxNodes, mode, minDegree };
  const cached = getCachedGraph(user.id, cacheParams);
  if (cached !== undefined) {
    return successResponse(cached);
  }

  try {
    const ctx = await createRagContext(user.id, { requireLlm: true });
    const result = await manageRag({
      userId: user.id,
      action: mode === "core" ? "core-graph" : mode === "overview" ? "overview-graph" : "graph",
      embedConfig: ctx.embedConfig,
      llmConfig: ctx.llmConfig!,
      rerankConfig: ctx.rerankConfig,
      embedDim: ctx.embedDim,
      entityName: entityName || undefined,
      depth,
      maxNodes,
      minDegree,
      signal: request.signal,
    });
    if (result.error) {
      return errorResponse(result.error as string, 500);
    }
    setCachedGraph(user.id, cacheParams, result);
    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("model configured")) {
      return errorResponse({ code: "ragNotConfigured", message: "Configure embedding and LLM models first" }, 400);
    }
    return errorResponse(error);
  }
}
