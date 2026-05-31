import { getAuthUser } from "@/lib/auth/session";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { name } = await params;
  if (!name) {
    return errorResponse("Entity name required", 400);
  }

  const { searchParams } = new URL(request.url);
  const depth = parseInt(searchParams.get("depth") || "2", 10);
  const maxNodes = parseInt(searchParams.get("max_nodes") || "100", 10);

  try {
    const ctx = await createRagContext(user.id, { requireLlm: true });
    const result = await manageRag({
      userId: user.id,
      action: "entity-detail",
      embedConfig: ctx.embedConfig,
      llmConfig: ctx.llmConfig!,
      rerankConfig: ctx.rerankConfig,
      embedDim: ctx.embedDim,
      entityName: decodeURIComponent(name),
      depth,
      maxNodes,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("model configured")) {
      return errorResponse("Configure embedding and LLM models first", 400);
    }
    return errorResponse(error);
  }
}
