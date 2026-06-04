import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { getQueue } from "@/lib/queue";
import { resolveLocale } from "@/lib/i18n/server";
import { resolveBrainstormLocale } from "@/lib/brainstorm/messages";
import { taskMatchesSession } from "@/lib/brainstorm/task-matching";

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

  const activeTasks = await db.asyncTask.findMany({
    where: {
      type: "outline_generate",
      status: { in: ["pending", "running"] },
      userId: user.id,
    },
    select: { id: true, status: true, progress: true, inputData: true },
  });
  const existingTask = activeTasks.find((task) => taskMatchesSession(task.inputData, id));
  if (existingTask) {
    getQueue();
    return successResponse({ taskId: existingTask.id, status: "pending", progress: 0 }, 201);
  }

  const queue = getQueue();
  const locale = resolveBrainstormLocale(request.headers.get("x-locale")) ?? await resolveLocale();
  const taskId = await queue.submit("outline_generate", { sessionId: id, userId: user.id, locale }, user.id);

  return successResponse({ taskId, status: "pending", progress: 0 }, 201);
}
