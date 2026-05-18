import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
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
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && error.message.includes("model configured")) {
      return NextResponse.json(
        { success: false, error: "Configure embedding and LLM models first" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
