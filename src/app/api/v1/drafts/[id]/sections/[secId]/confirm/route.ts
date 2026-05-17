import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { generateSummary } from "@/lib/writing/summarizer";
import { getErrorMessage } from "@/lib/api-helpers";
import type { ApiResponse } from "@/types/api";

async function generateSummaryBackground(sectionId: string, content: string, title: string) {
  try {
    const summary = await generateSummary(content, title);
    await db.section.update({
      where: { id: sectionId },
      data: { summary, status: "locked" },
    });
  } catch (err) {
    console.error(`Summary generation failed for section ${sectionId}:`, err);
    await db.section.update({
      where: { id: sectionId },
      data: { status: "locked" },
    });
  }
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

    const wordCount = section.content.split(/\s+/).filter(Boolean).length;
    const nextVersion = section.versions.length + 1;

    const versionSource = section.selectedModel
      ? section.selectedModel === "a" ? "generated_a" : "generated_b"
      : section.contentA || section.contentB ? "generated"
      : "edited";

    await db.sectionVersion.create({
      data: {
        sectionId,
        version: nextVersion,
        content: section.content,
        source: versionSource,
        wordCount,
      },
    });

    const locked = await db.section.update({
      where: { id: sectionId },
      data: { status: "locked", wordCount },
    });

    generateSummaryBackground(sectionId, section.content, section.title);

    return NextResponse.json({ success: true, data: locked });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
