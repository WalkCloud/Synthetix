import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> },
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

  try {
    const versions = await db.sectionVersion.findMany({
      where: { sectionId },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        source: true,
        wordCount: true,
        modelId: true,
        createdAt: true,
        content: true,
      },
    });

    return NextResponse.json({ success: true, data: versions });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
