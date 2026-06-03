import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;

  const doc = await db.document.findFirst({
    where: { id, userId: user.id },
    select: { id: true, originalName: true, markdownPath: true, status: true },
  });

  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  if (!doc.markdownPath) {
    return errorResponse({ code: "notFound", message: "Document not yet converted" }, 400);
  }

  const fs = await import("fs");
  if (!fs.existsSync(doc.markdownPath)) {
    return errorResponse({ code: "notFound", message: "Markdown file not found" }, 404);
  }

  const markdown = fs.readFileSync(doc.markdownPath, "utf-8");

  const rewritten = markdown.replace(
    /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
    `![$1](/api/v1/documents/${id}/images/$2)`
  );

  return successResponse({
    id: doc.id,
    name: doc.originalName,
    status: doc.status,
    markdown: rewritten,
  });
}
