import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { documentLifecycle } from "@/lib/documents/lifecycle";
import { deleteEntriesForDocument } from "@/lib/wiki/query";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, userId: user.id },
    include: {
      chunks: { orderBy: { index: "asc" } },
      tags: { include: { tag: true } },
      children: true,
    },
  });

  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  return successResponse({ ...doc, tags: doc.tags.map((dt) => dt.tag) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;

  // Check if user wants to also delete associated Wiki entries
  const url = new URL(request.url);
  const deleteWiki = url.searchParams.get("deleteWiki") === "true";

  const result = await documentLifecycle.deleteDocument(user.id, id);
  if ("notFound" in result) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  // Optionally delete Wiki entries sourced from this document
  let wikiResult: { deleted: number; updated: number } | undefined;
  if (deleteWiki) {
    wikiResult = await deleteEntriesForDocument(user.id, id).catch((err) => {
      console.warn("Failed to delete Wiki entries for document:", err);
      return { deleted: 0, updated: 0 };
    });
  }

  return successResponse({ ...result, wiki: wikiResult });
}
