import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const doc = await db.document.findFirst({
    where: { id, userId: user.id },
    select: { id: true, originalName: true, markdownPath: true, status: true },
  });

  if (!doc) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  if (!doc.markdownPath) {
    return NextResponse.json({ success: false, error: "Document not yet converted" }, { status: 400 });
  }

  const fs = await import("fs");
  if (!fs.existsSync(doc.markdownPath)) {
    return NextResponse.json({ success: false, error: "Markdown file not found" }, { status: 404 });
  }

  const markdown = fs.readFileSync(doc.markdownPath, "utf-8");

  // Rewrite relative image paths to absolute API paths
  const rewritten = markdown.replace(
    /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
    `![$1](/api/v1/documents/${id}/images/$2)`
  );

  // Return raw markdown — frontend renders with a markdown library
  return NextResponse.json({
    success: true,
    data: {
      id: doc.id,
      name: doc.originalName,
      status: doc.status,
      markdown: rewritten,
    },
  });
}
