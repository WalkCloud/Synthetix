import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse } from "@/lib/api-helpers";

const VALID_DOCUMENT_SORT_FIELDS = new Set([
  "createdAt", "updatedAt", "originalName", "originalSize", "status",
]);

function parseSort(sort: string, order: string | null, fallback: string): { sort: string; order: "asc" | "desc" } {
  const dir = (order?.toLowerCase() === "asc" ? "asc" : "desc") as "asc" | "desc";
  if (VALID_DOCUMENT_SORT_FIELDS.has(sort)) return { sort, order: dir };
  const lastUnderscore = sort.lastIndexOf("_");
  if (lastUnderscore > 0) {
    const maybeField = sort.slice(0, lastUnderscore);
    const maybeDir = sort.slice(lastUnderscore + 1);
    if (VALID_DOCUMENT_SORT_FIELDS.has(maybeField) && (maybeDir === "asc" || maybeDir === "desc")) {
      return { sort: maybeField, order: maybeDir as "asc" | "desc" };
    }
  }
  return { sort: fallback, order: dir };
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const rawSort = searchParams.get("sort") || "createdAt";
  const rawOrder = searchParams.get("order");
  const { sort, order } = parseSort(rawSort, rawOrder, "createdAt");

  const where: Record<string, unknown> = { userId: user.id };
  const status = searchParams.get("status");
  // A document is "pending" between upload and Start-Processing: the file is
  // persisted but the user hasn't kicked off the pipeline. Hide pending from the
  // default list (kept consistent with the library route) unless the caller
  // explicitly asks for it. This keeps the dashboard/recent-docs counts and the
  // library list in sync.
  if (status) {
    where.status = status;
  } else {
    where.status = { not: "pending" };
  }
  const format = searchParams.get("format");
  if (format) where.originalFormat = format;

  const [total, documents] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
      include: { tags: { include: { tag: true } }, chunks: { select: { id: true, title: true, tokenCount: true, headingPath: true, index: true } } },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: documents.map((d) => ({ ...d, tags: d.tags.map((dt) => dt.tag) })),
    total,
    page,
    limit,
  });
}
