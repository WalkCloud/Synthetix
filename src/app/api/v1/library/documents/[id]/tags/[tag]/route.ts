import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; tag: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id, tag: tagName } = await params;
  const tag = await db.tag.findUnique({ where: { name: tagName } });
  if (!tag) {
    return NextResponse.json({ success: false, error: "Tag not found" }, { status: 404 });
  }

  await db.documentTag.deleteMany({ where: { documentId: id, tagId: tag.id } });

  return NextResponse.json({ success: true });
}
