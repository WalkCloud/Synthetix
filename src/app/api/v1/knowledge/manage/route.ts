import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { resolveEmbeddingDim } from "@/lib/rag/dimension";
import { createEntity, deleteEntity, mergeEntities, buildConfig } from "@/lib/rag/client";
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

  const [embedModel, llmModel] = await Promise.all([
    resolveModel("embedding"),
    resolveModel("writing"),
  ]);

  if (!embedModel || !llmModel) {
    return NextResponse.json(
      { success: false, error: "Configure embedding and LLM models first" },
      { status: 400 },
    );
  }

  const embedDim = await resolveEmbeddingDim(embedModel).catch(() => 0);
  const embedCfg = await buildConfig(embedModel);
  const llmCfg = await buildConfig(llmModel);

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
        result = await createEntity(user.id, embedCfg, llmCfg, embedDim, entityName, entityType, description);
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
        result = await deleteEntity(user.id, embedCfg, llmCfg, embedDim, entityName);
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
        result = await mergeEntities(user.id, embedCfg, llmCfg, embedDim, sources, target);
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
