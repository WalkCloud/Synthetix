import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { resetUserKnowledgeBase, scanKnowledgeHealth } from "@/lib/knowledge/health";

export async function POST() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  try {
    const docs = await db.document.findMany({ where: { userId: user.id }, select: { id: true } });
    if (docs.length > 0) {
      return errorResponse({ code: "knowledgeResetBlocked", message: "Cannot reset knowledge base while documents exist. Delete documents first or use rebuild." }, 409);
    }

    await resetUserKnowledgeBase({ userId: user.id });
    const health = await scanKnowledgeHealth({ userId: user.id, activeDocumentIds: [] });
    return successResponse({ reset: true, health });
  } catch (error) {
    return errorResponse(error);
  }
}
