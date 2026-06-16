import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { lookupModel } from "@/lib/models/model-catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  if (!q || q.length < 2) {
    return NextResponse.json({ success: true, data: null });
  }

  const result = await lookupModel(q);
  if (!result) {
    return NextResponse.json({ success: true, data: null });
  }

  return NextResponse.json({
    success: true,
    data: {
      matchType: result.matchType,
      modelName: result.entry.key,
      contextWindow: result.entry.maxInputTokens,
      maxOutputTokens: result.entry.maxOutputTokens,
      embeddingDim: result.entry.embeddingDim,
      mode: result.entry.mode,
      inputPrice: result.entry.inputPrice,
      outputPrice: result.entry.outputPrice,
      provider: result.entry.provider,
    },
  });
}
