import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import type { ApiResponse } from "@/types/api";

const storage = new LocalStorageAdapter();

export async function GET(
  _request: Request,
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

  try {
    const content = await storage.readMarkdown(id, user.id);
    // Rewrite relative image paths to absolute API paths
    const rewritten = content.replace(
      /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
      `![$1](/api/v1/documents/${id}/images/$2)`
    );
    return NextResponse.json({ success: true, data: { content: rewritten } });
  } catch {
    return NextResponse.json(
      { success: false, error: "Content not yet available" },
      { status: 404 }
    );
  }
}
