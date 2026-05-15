import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { generateDiagramAsset } from "@/lib/writing/diagram-generator";
import type { ApiResponse } from "@/types/api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; secId: string; assetId: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId, secId: sectionId, assetId } = await params;

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return NextResponse.json({ success: false, error: "Draft not found" }, { status: 404 });
  }

  const asset = await db.sectionAsset.findFirst({
    where: { id: assetId, draftId, sectionId },
  });
  if (!asset) {
    return NextResponse.json({ success: false, error: "Asset not found" }, { status: 404 });
  }

  const result = await generateDiagramAsset(assetId);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: { assetId, path: result.path, status: "ready" },
  });
}
