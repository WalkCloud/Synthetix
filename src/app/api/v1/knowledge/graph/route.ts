import { getAuthUser } from "@/lib/auth/session";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
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
  const mode = searchParams.get("mode") || "graph";
  const minDegree = parseInt(searchParams.get("min_degree") || "2", 10);

  try {
    const ctx = await createRagContext(user.id, { requireLlm: true });
    const result = await manageRag({
      userId: user.id,
      action: mode === "core" ? "core-graph" : "graph",
      embedConfig: ctx.embedConfig,
      llmConfig: ctx.llmConfig!,
      embedDim: ctx.embedDim,
      entityName: entityName || undefined,
      depth,
      maxNodes,
      minDegree,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("model configured")) {
      return errorResponse("Configure embedding and LLM models first", 400);
    }
    return errorResponse(error);
  }
}
