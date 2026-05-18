import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const where: Record<string, unknown> = { userId: user.id };
  if (status) {
    where.status = { in: status.split(",") };
  }

  const tasks = await db.asyncTask.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      type: true,
      status: true,
      progress: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return successResponse(
    tasks.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      progress: t.progress,
      error: t.errorMessage,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  );
}
