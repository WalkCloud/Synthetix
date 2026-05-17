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
  const keyword = searchParams.get("q") || "";
  const limit = parseInt(searchParams.get("limit") || "50", 10);

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
      action: "entities",
      embedConfig: buildConfig(embedModel),
      llmConfig: buildConfig(llmModel),
      embedDim,
      keyword,
      limit,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
