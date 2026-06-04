import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { getQueue } from "@/lib/queue";
import { getBrainstormMessages } from "@/lib/brainstorm/messages";
import { taskMatchesSession } from "@/lib/brainstorm/task-matching";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!session) return errorResponse({ code: "notFound", message: "Not found" }, 404);
  return successResponse(session);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const body = await request.json();

  if (body.action === "clearOutline") {
    const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
    if (!session) return errorResponse({ code: "notFound", message: "Not found" }, 404);

    // Cancel any pending/running outline_generate tasks for this session
    const queue = getQueue();
    const runningTasks = await db.asyncTask.findMany({
      where: {
        type: "outline_generate",
        status: { in: ["pending", "running"] },
        userId: user.id,
      },
      select: { id: true, inputData: true },
    });
    for (const task of runningTasks.filter((task) => taskMatchesSession(task.inputData, id))) {
      await queue.cancel(task.id).catch(() => {});
    }

    // Clean up stale system messages from previous generation (both locales)
    const enMsgs = getBrainstormMessages("en");
    const zhMsgs = getBrainstormMessages("zh-CN");
    await db.message.deleteMany({
      where: {
        sessionId: id,
        role: "system",
        content: { in: [enMsgs.outlineReady, zhMsgs.outlineReady] },
      },
    });

    await db.brainstormSession.update({ where: { id }, data: { outline: null } });
    return successResponse(undefined);
  }

  if (body.action === "rename" && typeof body.title === "string" && body.title.trim()) {
    const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
    if (!session) return errorResponse({ code: "notFound", message: "Not found" }, 404);

    const updated = await db.brainstormSession.update({ where: { id }, data: { title: body.title.trim() } });
    return successResponse(updated);
  }

  return errorResponse({ code: "invalidInput", message: "Unknown action" }, 400);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  await db.brainstormSession.deleteMany({ where: { id, userId: user.id } });
  return successResponse(undefined);
}
