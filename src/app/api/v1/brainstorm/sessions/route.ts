import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const sessions = await db.brainstormSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });

  return successResponse(sessions);
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { title } = await request.json();
  if (!title || typeof title !== "string") {
    return errorResponse({ code: "invalidInput", message: "Title required" }, 400);
  }

  const session = await db.brainstormSession.create({
    data: { userId: user.id, title, status: "active" },
  });

  await db.message.create({
    data: { sessionId: session.id, role: "system", content: "A new brainstorming session has been created. Please describe your document writing needs." },
  });

  return successResponse(session, 201);
}
