import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { resolveEmbeddingDim } from "@/lib/rag/dimension";
import { getEntityDetail, buildConfig } from "@/lib/rag/client";
import type { ApiResponse } from "@/types/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;
  if (!name) {
    return NextResponse.json({ success: false, error: "Entity name required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const depth = parseInt(searchParams.get("depth") || "2", 10);
  const maxNodes = parseInt(searchParams.get("max_nodes") || "100", 10);

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
    const result = await getEntityDetail(
      user.id,
      await buildConfig(embedModel),
      await buildConfig(llmModel),
      embedDim,
      decodeURIComponent(name),
      depth,
      maxNodes,
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
