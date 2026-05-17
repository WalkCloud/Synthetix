import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { getErrorMessage } from "@/lib/api-helpers";
import type { ApiResponse } from "@/types/api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id: draftId } = await params;

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
    });
    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 }
      );
    }

    const sections = await db.section.findMany({
      where: {
        draftId,
        status: { in: ["locked", "summarized"] },
      },
      orderBy: { index: "asc" },
    });

    if (sections.length === 0) {
      return NextResponse.json(
        { success: false, error: "No confirmed sections available to assemble" },
        { status: 400 }
      );
    }

    // Build assembled markdown
    const titleHeader = `# ${draft.title}\n\n`;
    const sectionParts = sections.map(
      (section) => `## ${section.title}\n\n${section.content ?? ""}\n\n`
    );
    const markdown = titleHeader + sectionParts.join("");

    return NextResponse.json({
      success: true,
      data: { markdown, sectionCount: sections.length },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
