import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { documentLifecycle } from "@/lib/documents/lifecycle";
import { deleteEntriesForDocuments } from "@/lib/wiki/query";
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

  // Wiki deletion is explicit. If it fails after the document row was removed,
  // return a truthful partial-cleanup result instead of reporting zero changes.
  let wikiResult: { deleted: number; updated: number; orphansPurged: number } | undefined;
  let wikiCleanupError: string | undefined;
  if (deleteWiki) {
    try {
      wikiResult = await deleteEntriesForDocuments(user.id, [id]);
    } catch (error) {
      wikiCleanupError = error instanceof Error ? error.message : String(error);
      result.issues.push(`Wiki cleanup failed: ${wikiCleanupError}`);
      console.warn("Failed to delete Wiki entries for document:", error);
    }
  }

  return successResponse({ ...result, wiki: wikiResult, wikiCleanupError });
}
