import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { scanKnowledgeHealth } from "@/lib/knowledge/health";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  try {
    const docs = await db.document.findMany({ where: { userId: user.id }, select: { id: true } });
    const health = await scanKnowledgeHealth({
      userId: user.id,
      activeDocumentIds: docs.map((doc) => doc.id),
    });
    return successResponse(health);
  } catch (error) {
    return errorResponse(error);
  }
}
