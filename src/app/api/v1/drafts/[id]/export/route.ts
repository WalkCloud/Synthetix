import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse> | Response> {
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
        { success: false, error: "No confirmed sections available to export" },
        { status: 400 }
      );
    }

    // Build assembled markdown
    const titleHeader = `# ${draft.title}\n\n`;
    const sectionParts = sections.map(
      (section) => `## ${section.title}\n\n${section.content ?? ""}\n\n`
    );
    const markdown = titleHeader + sectionParts.join("");

    const filename = sanitizeFilename(draft.title) || "document";

    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.md"`,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
