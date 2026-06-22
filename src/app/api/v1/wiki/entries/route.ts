import { getAuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getWikiStats } from "@/lib/wiki/query";
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
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

  const where: Prisma.WikiEntryWhereInput = {
    userId: user.id,
    status: "active",
  };
  if (type && ["doc_summary", "topic", "concept", "claim"].includes(type)) {
    where.type = type;
  }
  if (q.trim()) {
    where.OR = [
      { title: { contains: q } },
      { content: { contains: q } },
    ];
  }

  const [entries, total, stats] = await Promise.all([
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
    getWikiStats(user.id),
  ]);

  // Truncate content for list view (full content only on detail endpoint)
  const items = entries.map((e) => ({
    ...e,
    contentPreview: e.content.slice(0, 200),
    content: undefined,
    sourceRefCount: parseSourceRefCount(e.sourceRefs),
    sourceRefs: undefined,
  }));

  return successResponse({
    items,
    total,
    page,
    limit,
    stats,
  });
}

function parseSourceRefCount(raw: string): number {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
