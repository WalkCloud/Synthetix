import { getAuthUser } from "@/lib/auth/session";
import { documentLifecycle } from "@/lib/documents/lifecycle";
import { deleteEntriesForDocuments } from "@/lib/wiki/query";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function DELETE(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { ids, deleteWiki }: { ids: string[]; deleteWiki?: boolean } = await request.json();
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return errorResponse({ code: "invalidInput", message: "ids required" }, 400);
  }

  const result = await documentLifecycle.deleteDocuments(user.id, ids);

  // One full-table scan handles every document that was actually deleted. Do
  // not pass unowned/missing request IDs into Wiki mutation, and do not disguise
  // a failed cleanup as a successful zero-count result.
  let wikiDeleted = 0;
  let wikiUpdated = 0;
  let wikiOrphansPurged = 0;
  let wikiCleanupError: string | undefined;
  if (deleteWiki && result.deleted.length > 0) {
    try {
      const r = await deleteEntriesForDocuments(user.id, result.deleted);
      wikiDeleted = r.deleted;
      wikiUpdated = r.updated;
      wikiOrphansPurged = r.orphansPurged;
    } catch (error) {
      wikiCleanupError = error instanceof Error ? error.message : String(error);
      console.warn("Failed to delete Wiki entries for document batch:", error);
    }
  }

  return successResponse({
    deleted: result.deleted.length,
    results: result.results,
    wikiDeleted,
    wikiUpdated,
    wikiOrphansPurged,
    wikiCleanupError,
  });
}
