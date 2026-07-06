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

  // Default behaviour: deleteWiki is TRUE → wipe Wiki entries sourced from
  // these docs (full strip for sole-sourced entries, ref removal for fused).
  // Only when the user explicitly opts to KEEP wiki (deleteWiki=false) do we
  // leave wiki untouched — including source refs. This is the user's "I want
  // to keep my distilled knowledge" escape hatch.
  //
  // One single full-table scan handles all docIds at once (vs the previous
  // per-doc loop), and runs here in the route so the cleanup worker no longer
  // touches wiki (it used to strip refs unconditionally, ignoring deleteWiki).
  let wikiDeleted = 0;
  let wikiOrphansPurged = 0;
  if (deleteWiki) {
    const r = await deleteEntriesForDocuments(user.id, ids).catch(() => ({ deleted: 0, updated: 0, orphansPurged: 0 }));
    wikiDeleted = r.deleted;
    wikiOrphansPurged = r.orphansPurged;
  }

  return successResponse({
    deleted: result.deleted.length,
    results: result.results,
    wikiDeleted,
    wikiOrphansPurged,
  });
}
