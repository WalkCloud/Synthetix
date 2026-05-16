import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId, secId: sectionId } = await params;

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return NextResponse.json({ success: false, error: "Draft not found" }, { status: 404 });
  }

  const assets = await db.sectionAsset.findMany({
    where: { draftId, sectionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      title: true,
      status: true,
      mimeType: true,
      prompt: true,
      path: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ success: true, data: assets });
}
