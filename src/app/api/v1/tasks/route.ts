import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";
import { parseTaskResult } from "@/lib/queue/task-json";
import { compareTaskIdentitySources } from "@/lib/queue/task-identity-legacy";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const where: Record<string, unknown> = { userId: user.id };
  if (status) {
    where.status = { in: status.split(",") };
  }
  if (type) {
    where.type = type;
  }
  const includeResultData = type === "draft_generate_all" || type === "rag_index";

  const tasks = await db.asyncTask.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      type: true,
      status: true,
      progress: true,
      inputData: true,
      documentId: true,
      draftId: true,
      sectionId: true,
      sessionId: true,
      attempt: true,
      resultData: includeResultData,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return successResponse(
    tasks.map((t) => {
      const identity = compareTaskIdentitySources(t).authoritative;
      const result = includeResultData
        ? parseTaskResult<unknown>(t.resultData, null)
        : null;

      return {
        id: t.id,
        type: t.type,
        status: t.status,
        progress: t.progress,
        draftId: identity.draftId,
        sessionId: identity.sessionId,
        sectionId: identity.sectionId,
        docId: identity.documentId,
        result,
        error: t.errorMessage,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    }),
  );
}
