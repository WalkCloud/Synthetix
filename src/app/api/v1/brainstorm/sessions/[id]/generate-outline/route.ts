import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { getQueue } from "@/lib/queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!session) return errorResponse({ code: "notFound", message: "Not found" }, 404);

  const existingTask = await db.asyncTask.findFirst({
    where: {
      type: "outline_generate",
      status: { in: ["pending", "running"] },
      inputData: { contains: id },
    },
  });
  if (existingTask) {
    return successResponse({ taskId: existingTask.id, status: "pending", progress: 0 }, 201);
  }

  const queue = getQueue();
  const taskId = await queue.submit("outline_generate", { sessionId: id, userId: user.id }, user.id);

  return successResponse({ taskId, status: "pending", progress: 0 }, 201);
}
