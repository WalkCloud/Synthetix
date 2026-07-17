import { getAuthUser } from "@/lib/auth/session";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import { invalidateUserGraph } from "@/lib/knowledge/graph-cache";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const body = await request.json();
  const { action } = body;

  if (!action) {
    return errorResponse({ code: "invalidInput", message: "action required" }, 400);
  }

  let ctx: Awaited<ReturnType<typeof createRagContext>>;
  try {
    ctx = await createRagContext(user.id, { requireLlm: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes("model configured")) {
      return errorResponse({ code: "ragNotConfigured", message: "Configure embedding and LLM models first" }, 400);
    }
    throw error;
  }

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case "create-entity": {
        const { entityName, entityType, description } = body;
        if (!entityName || !entityType || !description) {
          return errorResponse({ code: "invalidInput", message: "entityName, entityType, and description required" }, 400);
        }
        result = await manageRag({ userId: user.id, action: "create-entity", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, rerankConfig: ctx.rerankConfig, embedDim: ctx.embedDim, entityName, entityType, description, signal: request.signal });
        break;
      }
      case "delete-entity": {
        const { entityName } = body;
        if (!entityName) {
          return errorResponse({ code: "invalidInput", message: "entityName required" }, 400);
        }
        result = await manageRag({ userId: user.id, action: "delete-entity", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, rerankConfig: ctx.rerankConfig, embedDim: ctx.embedDim, entityName, signal: request.signal });
        break;
      }
      case "merge-entities": {
        const { sources, target } = body;
        if (!sources || !target || !Array.isArray(sources) || sources.length < 2) {
          return errorResponse({ code: "invalidInput", message: "sources (array of 2+ names) and target required" }, 400);
        }
        result = await manageRag({ userId: user.id, action: "merge-entities", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, rerankConfig: ctx.rerankConfig, embedDim: ctx.embedDim, sources: sources.join(","), target, signal: request.signal });
        break;
      }
      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }

    if (result.error) {
      return errorResponse(result.error as string, 500);
    }
    // Entity mutations change the graph topology — drop cached graphs so the
    // next read reflects the new state instead of a stale snapshot.
    invalidateUserGraph(user.id);
    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
