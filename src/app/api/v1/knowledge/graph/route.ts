import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { resolveEmbeddingDim } from "@/lib/rag/dimension";
import { manageRag, buildConfig } from "@/lib/rag/client";
import type { ApiResponse } from "@/types/api";

export async function GET(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entityName = searchParams.get("entity") || "";
  const depth = parseInt(searchParams.get("depth") || "3", 10);
  const maxNodes = parseInt(searchParams.get("max_nodes") || "200", 10);
  const mode = searchParams.get("mode") || "graph";
  const minDegree = parseInt(searchParams.get("min_degree") || "2", 10);

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

  try {
    const embedDim = await resolveEmbeddingDim(embedModel).catch(() => 0);
    const result = await manageRag({
      userId: user.id,
      action: mode === "core" ? "core-graph" : "graph",
      embedConfig: buildConfig(embedModel),
      llmConfig: buildConfig(llmModel),
      embedDim,
      entityName: entityName || undefined,
      depth,
      maxNodes,
      minDegree,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
