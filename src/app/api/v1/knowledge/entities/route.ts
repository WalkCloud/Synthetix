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
  const keyword = searchParams.get("q") || "";
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  try {
    const ctx = await createRagContext(user.id, { requireLlm: true });
    const result = await manageRag({
      userId: user.id,
      action: "entities",
      embedConfig: ctx.embedConfig,
      llmConfig: ctx.llmConfig!,
      rerankConfig: ctx.rerankConfig,
      embedDim: ctx.embedDim,
      keyword,
      limit,
      signal: request.signal,
    });
    if (result.error) {
      return errorResponse(result.error as string, 500);
    }
    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("model configured")) {
      return errorResponse({ code: "ragNotConfigured", message: "Configure embedding and LLM models first" }, 400);
    }
    return errorResponse(error);
  }
}
