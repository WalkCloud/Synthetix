import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

const storage = new LocalStorageAdapter();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  try {
    const content = await storage.readMarkdown(id, user.id);
    const rewritten = content.replace(
      /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
      `![$1](/api/v1/documents/${id}/images/$2)`
    );
    return successResponse({ content: rewritten });
  } catch {
    return errorResponse({ code: "notFound", message: "Content not yet available" }, 404);
  }
}
