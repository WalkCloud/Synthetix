import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const { name } = await request.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json({ success: false, error: "Tag name required" }, { status: 400 });
  }

  const tag = await db.tag.upsert({
    where: { name: name.toLowerCase().trim() },
    update: {},
    create: { name: name.toLowerCase().trim() },
  });

  await db.documentTag.upsert({
    where: { documentId_tagId: { documentId: id, tagId: tag.id } },
    update: {},
    create: { documentId: id, tagId: tag.id },
  });

  return NextResponse.json({ success: true, data: tag });
}
