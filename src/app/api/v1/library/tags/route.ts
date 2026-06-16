import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse } from "@/lib/api-helpers";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const tags = await db.tag.findMany({
    include: {
      _count: {
        select: { documents: { where: { document: { userId: user.id } } } },
      },
    },
    orderBy: { name: "asc" },
  });

  const result = tags
    .filter((t) => t._count.documents > 0)
    .map((t) => ({ id: t.id, name: t.name, count: t._count.documents }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ success: true, data: result });
}
