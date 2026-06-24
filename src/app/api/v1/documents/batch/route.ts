import { getAuthUser } from "@/lib/auth/session";
import { documentLifecycle } from "@/lib/documents/lifecycle";
import { deleteEntriesForDocument } from "@/lib/wiki/query";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function DELETE(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { ids, deleteWiki }: { ids: string[]; deleteWiki?: boolean } = await request.json();
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return errorResponse({ code: "invalidInput", message: "ids required" }, 400);
  }

  const result = await documentLifecycle.deleteDocuments(user.id, ids);

  // Optionally delete Wiki entries sourced from these documents
  let wikiDeleted = 0;
  if (deleteWiki) {
    for (const docId of ids) {
      const r = await deleteEntriesForDocument(user.id, docId).catch(() => ({ deleted: 0, updated: 0 }));
      wikiDeleted += r.deleted;
    }
  }

  return successResponse({ deleted: result.deleted.length, results: result.results, wikiDeleted });
}
