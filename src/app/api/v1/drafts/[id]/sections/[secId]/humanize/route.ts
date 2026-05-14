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

    const hasContent = section.content?.trim();
    const hasComparison = section.contentA?.trim() || section.contentB?.trim();

    if (!hasContent && !hasComparison) {
      return NextResponse.json(
        { success: false, error: "No content to humanize" },
        { status: 400 }
      );
    }

    let updatedSection;
    let auditNotes: string;

    if (hasComparison && section.status === "comparing") {
      const tasks: Promise<{ content: string; contentField: string; notes: string }>[] = [];

      if (section.contentA?.trim()) {
        tasks.push(
          humanizeContent(section.contentA, section.title, user.id)
            .then((r) => ({ content: r.content, contentField: "contentA", notes: r.auditNotes }))
        );
      }
      if (section.contentB?.trim()) {
        tasks.push(
          humanizeContent(section.contentB, section.title, user.id)
            .then((r) => ({ content: r.content, contentField: "contentB", notes: r.auditNotes }))
        );
      }

      const results = await Promise.all(tasks);
      const updateData: Record<string, unknown> = {};
      let lastNotes = "";

      for (const r of results) {
        updateData[r.contentField] = r.content;
        lastNotes = r.notes;
      }

      const effectiveContent = section.content || section.contentA || section.contentB || "";
      updateData["wordCount"] = effectiveContent.split(/\s+/).filter(Boolean).length;

      updatedSection = await db.section.update({
        where: { id: sectionId },
        data: updateData,
      });
      auditNotes = lastNotes;
    } else {
      const result = await humanizeContent(
        section.content!,
        section.title,
        user.id
      );

      updatedSection = await db.section.update({
        where: { id: sectionId },
        data: {
          content: result.content,
          wordCount: result.content.split(/\s+/).filter(Boolean).length,
        },
      });
      auditNotes = result.auditNotes;
    }

    return NextResponse.json({
      success: true,
      data: {
        section: updatedSection,
        auditNotes,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
