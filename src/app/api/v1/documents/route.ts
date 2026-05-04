import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

export async function GET(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const sort = searchParams.get("sort") || "createdAt";
  const order = (searchParams.get("order") || "desc") as "asc" | "desc";

  const where: Record<string, unknown> = { userId: user.id };
  const status = searchParams.get("status");
  if (status) where.status = status;
  const format = searchParams.get("format");
  if (format) where.originalFormat = format;

  const [total, documents] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
      include: { tags: { include: { tag: true } }, chunks: { select: { id: true, title: true, tokenCount: true } } },
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
