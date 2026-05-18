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
  const keyword = searchParams.get("q") || "";
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  try {
    const ctx = await createRagContext(user.id, { requireLlm: true });
    const result = await manageRag({
      userId: user.id,
      action: "entities",
      embedConfig: ctx.embedConfig,
      llmConfig: ctx.llmConfig!,
      embedDim: ctx.embedDim,
      keyword,
      limit,
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
