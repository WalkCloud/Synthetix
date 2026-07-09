import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse } from "@/lib/api-helpers";
import type { DocumentListParams } from "@/types/documents";
import { annotateDocumentsWithDisplayStatus } from "@/lib/documents/display-status";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const sort = (searchParams.get("sort") || "createdAt") as NonNullable<DocumentListParams["sort"]>;
  const order = (searchParams.get("order") || "desc") as "asc" | "desc";
  const format = searchParams.get("format") || undefined;
  const status = searchParams.get("status") || undefined;
  const tag = searchParams.get("tag") || undefined;
  const tagsParam = searchParams.get("tags") || undefined;
  const tagNames = tagsParam
    ? tagsParam.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
    : tag
      ? [tag.toLowerCase()]
      : undefined;

  // A document is "pending" between upload and Start-Processing: the file is
  // persisted and ready to process, but the user hasn't actually kicked off the
  // pipeline yet. Surfacing those in the library is confusing — it looks like
  // processing is stuck. So we hide pending from the default list and only
  // return them when the user explicitly filters by status=pending.
  const where: Record<string, unknown> = { userId: user.id };
  if (status) {
    where.status = status;
  } else {
    where.status = { not: "pending" };
  }
  if (format) where.originalFormat = format;
  if (tagNames && tagNames.length === 1) {
    where.tags = { some: { tag: { name: tagNames[0] } } };
  } else if (tagNames && tagNames.length > 1) {
    where.tags = { some: { tag: { name: { in: tagNames } } } };
  }

  const [total, documents] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        tags: { include: { tag: true } },
        chunks: { select: { id: true, title: true, tokenCount: true, headingPath: true, index: true } },
      },
    }),
  ]);

  // Compute a consistent, task-driven display status shared with the detail
  // page and the dashboard recent-docs list so all three never disagree.
  // (Queue positions, branch tasks, pipeline computation and displayStatus all
  // live in this one shared helper — see src/lib/documents/display-status.ts.)
  const annotations = await annotateDocumentsWithDisplayStatus(db, user.id, documents);

  return NextResponse.json({
    success: true,
    data: documents.map((d, i) => ({
      ...d,
      tags: d.tags.map((dt) => dt.tag),
      ...annotations[i],
    })),
    total,
    page,
    limit,
  });
}
