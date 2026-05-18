import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import type { ApiResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  if (!action) {
    return NextResponse.json({ success: false, error: "action required" }, { status: 400 });
  }

  let ctx: Awaited<ReturnType<typeof createRagContext>>;
  try {
    ctx = await createRagContext(user.id, { requireLlm: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes("model configured")) {
      return NextResponse.json(
        { success: false, error: "Configure embedding and LLM models first" },
        { status: 400 },
      );
    }
    throw error;
  }

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case "create-entity": {
        const { entityName, entityType, description } = body;
        if (!entityName || !entityType || !description) {
          return NextResponse.json(
            { success: false, error: "entityName, entityType, and description required" },
            { status: 400 },
          );
        }
        result = await manageRag({ userId: user.id, action: "create-entity", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, embedDim: ctx.embedDim, entityName, entityType, description });
        break;
      }
      case "delete-entity": {
        const { entityName } = body;
        if (!entityName) {
          return NextResponse.json(
            { success: false, error: "entityName required" },
            { status: 400 },
          );
        }
        result = await manageRag({ userId: user.id, action: "delete-entity", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, embedDim: ctx.embedDim, entityName });
        break;
      }
      case "merge-entities": {
        const { sources, target } = body;
        if (!sources || !target || !Array.isArray(sources) || sources.length < 2) {
          return NextResponse.json(
            { success: false, error: "sources (array of 2+ names) and target required" },
            { status: 400 },
          );
        }
        result = await manageRag({ userId: user.id, action: "merge-entities", embedConfig: ctx.embedConfig, llmConfig: ctx.llmConfig!, embedDim: ctx.embedDim, sources: sources.join(","), target });
        break;
      }
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
