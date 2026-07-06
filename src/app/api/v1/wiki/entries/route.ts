import { getAuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getWikiStats } from "@/lib/wiki/query";
import { searchWikiFts, isWikiFtsEnabled, stripWikiFtsSnippetMarkup, removeWikiFtsForEntries } from "@/lib/search/wiki-fts";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import type { Prisma } from "@/generated/prisma/client";

/**
 * GET /api/v1/wiki/entries
 *
 * List the user's Wiki entries (the synthesized knowledge layer).
 * Supports filtering by type + text search + pagination.
 *
 * Query params:
 *   type   — filter by entry type (doc_summary | topic | concept | claim)
 *   q      — full-text search on title + content
 *   page   — 1-based page number (default 1)
 *   limit  — page size (default 20, max 100)
 */
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || undefined;
  const q = searchParams.get("q") || "";
  const documentIds = searchParams.getAll("documentId"); // supports multiple
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

  const where: Prisma.WikiEntryWhereInput = {
    userId: user.id,
    status: "active",
  };
  if (type && ["doc_summary", "topic", "concept", "claim"].includes(type)) {
    where.type = type;
  }

  // Search recall. Two strategies:
  //   - FTS path (default): jieba-tokenised FTS5 MATCH, ranked by relevance.
  //     Produces an ordered list of entry ids + a highlighted snippet per hit.
  //   - Legacy LIKE path (WIKI_FTS_ENABLED=off): raw substring on q.
  // When FTS is enabled we capture the ranked id order so the final list can be
  // sorted by relevance (the legacy path only offered updatedAt-desc).
  let ftsRankedIds: string[] | null = null;
  const ftsSnippets = new Map<string, string>();
  if (q.trim()) {
    if (isWikiFtsEnabled()) {
      // Over-fetch (cap 200) so type/document filters + pagination still have
      // room after the intersection. Cheap: FTS is pure SQL.
      const hits = await searchWikiFts(q, user.id, 200);
      if (hits.length > 0) {
        ftsRankedIds = hits.map((h) => h.entryId);
        for (const h of hits) {
          if (h.snippet) ftsSnippets.set(h.entryId, stripWikiFtsSnippetMarkup(h.snippet));
        }
        where.id = { in: ftsRankedIds };
      } else {
        // FTS returned nothing (cold index, no match, or query had no tokens).
        // Fall back to LIKE so the search box still works during warmup.
        where.OR = [
          { title: { contains: q } },
          { content: { contains: q } },
        ];
      }
    } else {
      where.OR = [
        { title: { contains: q } },
        { content: { contains: q } },
      ];
    }
  }

  // Filter by source document(s). sourceRefs is JSON, so SQLite can't query
  // it natively — fetch matching entry IDs first, then constrain the main query.
  // Intersect with any FTS-recalled id set so the two filters compose (AND).
  if (documentIds.length > 0) {
    const allRefs = await db.wikiEntry.findMany({
      where: { userId: user.id, status: "active" },
      select: { id: true, sourceRefs: true },
    });
    const matchedIds = allRefs
      .filter((e) => {
        try {
          const refs = JSON.parse(e.sourceRefs) as Array<{ documentId?: string }>;
          return Array.isArray(refs) && refs.some((r) => r.documentId && documentIds.includes(r.documentId));
        } catch { return false; }
      })
      .map((e) => e.id);
    // `where.id` here is either undefined or the `{ in: [...] }` shape set by the
    // FTS recall above — narrow past the `string` branch of the union so TS sees `.in`.
    const prevIdFilter = where.id;
    const prev = typeof prevIdFilter === "object" && prevIdFilter ? prevIdFilter.in : undefined;
    const intersected = prev ? matchedIds.filter((id) => prev.includes(id)) : matchedIds;
    where.id = { in: intersected };
    if (ftsRankedIds) ftsRankedIds = ftsRankedIds.filter((id) => intersected.includes(id));
  }

  // Lightweight mode: return ALL matching entry IDs (no pagination, no content).
  // Used by the "select all" button to select across all pages.
  if (searchParams.get("idsOnly") === "true") {
    const allEntries = await db.wikiEntry.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    // Preserve FTS relevance order when available.
    let ids = allEntries.map((e) => e.id);
    if (ftsRankedIds) {
      const order = new Map(ftsRankedIds.map((id, i) => [id, i] as const));
      ids.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
    }
    return successResponse({ ids, total: ids.length });
  }

  // When FTS ranked the recall, we must preserve that order — but Prisma's
  // orderBy can't express an arbitrary id sequence. Since the FTS candidate
  // set is already small (≤200), fetch all matching rows and reorder in JS,
  // then paginate. The non-FTS path keeps the streaming Prisma pagination.
  let entries: Array<{
    id: string; type: string; title: string; slug: string; content: string;
    confidence: number; status: string; sourceRefs: string;
    createdAt: Date; updatedAt: Date;
  }>;
  let total: number;
  const stats = await getWikiStats(user.id);

  if (ftsRankedIds) {
    const order = new Map(ftsRankedIds.map((id, i) => [id, i] as const));
    const allMatched = await db.wikiEntry.findMany({
      where,
      select: {
        id: true, type: true, title: true, slug: true, content: true,
        confidence: true, status: true, sourceRefs: true,
        createdAt: true, updatedAt: true,
      },
    });
    total = allMatched.length;
    allMatched.sort(
      (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    entries = allMatched.slice((page - 1) * limit, page * limit);
  } else {
    [entries, total] = await Promise.all([
      db.wikiEntry.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          slug: true,
          content: true,
          confidence: true,
          status: true,
          sourceRefs: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.wikiEntry.count({ where }),
    ]);
  }

  // Truncate content for list view (full content only on detail endpoint).
  // When FTS supplied a highlight snippet, surface it as the preview so the UI
  // can show the matching context instead of a generic head-of-content slice.
  const items = entries.map((e) => {
    const snippet = ftsSnippets.get(e.id);
    return {
      ...e,
      contentPreview: snippet && snippet.length > 0 ? snippet : e.content.slice(0, 200),
      content: undefined,
      sourceRefCount: parseSourceRefCount(e.sourceRefs),
      sourceRefs: undefined,
    };
  });

  return successResponse({
    items,
    total,
    page,
    limit,
    stats,
  });
}

/**
 * DELETE /api/v1/wiki/entries
 *
 * Batch delete Wiki entries. Body: { ids: string[] }
 * Cascades to WikiLink + WikiChangeLog via Prisma relations.
 */
export async function DELETE(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  let body: { ids?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse({ code: "invalidBody", message: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return errorResponse({ code: "missingIds", message: "ids array is required" }, 400);
  }

  const result = await db.wikiEntry.deleteMany({
    where: { id: { in: body.ids }, userId: user.id },
  });
  // Remove the deleted entries from the FTS index. Non-blocking.
  void removeWikiFtsForEntries(body.ids).catch(() => {});

  return successResponse({ deleted: result.count });
}

function parseSourceRefCount(raw: string): number {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
