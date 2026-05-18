import { getAuthUser } from "@/lib/auth/session";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const body = await request.json();
  const { action } = body;

  if (!action) {
    return errorResponse("action required", 400);
  }

  let ctx: Awaited<ReturnType<typeof createRagContext>>;
  try {
    ctx = await createRagContext(user.id, { requireLlm: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes("model configured")) {
      return errorResponse("Configure embedding and LLM models first", 400);
    }
    throw error;
  }

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case "create-entity": {
        const { entityName, entityType, description } = body;
        if (!entityName || !entityType || !description) {
          return errorResponse("entityName, entityType, and description required", 400);
        }
        result = await manageRag({ userId: user.id, action: "create-entity", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, embedDim: ctx.embedDim, entityName, entityType, description });
        break;
      }
      case "delete-entity": {
        const { entityName } = body;
        if (!entityName) {
          return errorResponse("entityName required", 400);
        }
        result = await manageRag({ userId: user.id, action: "delete-entity", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, embedDim: ctx.embedDim, entityName });
        break;
      }
      case "merge-entities": {
        const { sources, target } = body;
        if (!sources || !target || !Array.isArray(sources) || sources.length < 2) {
          return errorResponse("sources (array of 2+ names) and target required", 400);
        }
        result = await manageRag({ userId: user.id, action: "merge-entities", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, embedDim: ctx.embedDim, sources: sources.join(","), target });
        break;
      }
      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }

    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
