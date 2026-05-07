import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { humanizeContent } from "@/lib/writing/humanizer";
import type { ApiResponse } from "@/types/api";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id: draftId, secId: sectionId } = await params;

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { id: true },
    });
    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 }
      );
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, draftId },
    });
    if (!section) {
      return NextResponse.json(
        { success: false, error: "Section not found" },
        { status: 404 }
      );
    }

    if (!section.content?.trim()) {
      return NextResponse.json(
        { success: false, error: "No content to humanize" },
        { status: 400 }
      );
    }

    const result = await humanizeContent(
      section.content,
      section.title,
      user.id
    );

    const updatedSection = await db.section.update({
      where: { id: sectionId },
      data: {
        content: result.content,
        wordCount: result.content.split(/\s+/).filter(Boolean).length,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        section: updatedSection,
        auditNotes: result.auditNotes,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
