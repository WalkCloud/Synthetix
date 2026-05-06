import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { generateSummary } from "@/lib/writing/summarizer";
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
      include: { versions: true },
    });
    if (!section) {
      return NextResponse.json(
        { success: false, error: "Section not found" },
        { status: 404 }
      );
    }

    // Must have content — if only comparison results exist, user must select first
    if (!section.content) {
      if (section.contentA || section.contentB) {
        return NextResponse.json(
          {
            success: false,
            error: "Please select a source (A or B) before confirming",
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { success: false, error: "Section has no content to confirm" },
        { status: 400 }
      );
    }

    // Create SectionVersion snapshot
    const wordCount = section.content.split(/\s+/).filter(Boolean).length;
    const nextVersion = section.versions.length + 1;

    await db.sectionVersion.create({
      data: {
        sectionId,
        version: nextVersion,
        content: section.content,
        source: "edited",
        wordCount,
      },
    });

    // Generate summary for context compression
    const summary = await generateSummary(section.content, section.title);

    // Update section: summary + summarized status, then locked
    const summarized = await db.section.update({
      where: { id: sectionId },
      data: {
        summary,
        wordCount,
        status: "summarized",
      },
    });

    const locked = await db.section.update({
      where: { id: sectionId },
      data: { status: "locked" },
    });

    return NextResponse.json({ success: true, data: locked });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
