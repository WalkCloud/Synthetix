import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { auditSection } from "@/lib/writing/auditor";
import type { ApiResponse } from "@/types/api";

export async function POST(
  _request: Request,
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

  const section = await db.section.findFirst({
    where: { id: sectionId, draftId },
  });
  if (!section) {
    return NextResponse.json({ success: false, error: "Section not found" }, { status: 404 });
  }

  if (!section.content) {
    return NextResponse.json({ success: false, error: "Section has no content to audit" }, { status: 400 });
  }

  const result = await auditSection(section.title, section.content, section.keyPoints);

  await db.section.update({
    where: { id: sectionId },
    data: {
      constraints: JSON.stringify({
        ...(section.constraints ? JSON.parse(section.constraints) : {}),
        _audit: result,
      }),
    },
  });

  return NextResponse.json({ success: true, data: result });
}
