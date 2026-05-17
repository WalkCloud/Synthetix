import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { getErrorMessage } from "@/lib/api-helpers";
import type { ApiResponse } from "@/types/api";

export async function POST(
  request: Request,
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

  const body = await request.json();
  const targetVersion = body.version;

  if (!targetVersion || typeof targetVersion !== "number") {
    return NextResponse.json(
      { success: false, error: "version (number) required" },
      { status: 400 },
    );
  }

  try {
    const target = await db.sectionVersion.findFirst({
      where: { sectionId, version: targetVersion },
    });

    if (!target) {
      return NextResponse.json(
        { success: false, error: `Version ${targetVersion} not found` },
        { status: 404 },
      );
    }

    // Restore section content from the version snapshot
    await db.section.update({
      where: { id: sectionId },
      data: {
        content: target.content,
        wordCount: target.wordCount,
        status: "reviewing",
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        rolledBack: true,
        toVersion: targetVersion,
        content: target.content,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
