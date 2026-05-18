import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse } from "@/lib/api-helpers";
import type { DocumentListParams } from "@/types/documents";

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

  const where: Record<string, unknown> = { userId: user.id };
  if (status) where.status = status;
  if (format) where.originalFormat = format;
  if (tag) where.tags = { some: { tag: { name: tag } } };

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

  return NextResponse.json({
    success: true,
    data: documents.map((d) => ({ ...d, tags: d.tags.map((dt) => dt.tag) })),
    total,
    page,
    limit,
  });
}
