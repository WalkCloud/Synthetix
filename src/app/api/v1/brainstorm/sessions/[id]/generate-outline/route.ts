import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { getQueue } from "@/lib/queue";
import { resolveLocale } from "@/lib/i18n/server";
import { resolveBrainstormLocale } from "@/lib/brainstorm/messages";
import { taskMatchesSession } from "@/lib/brainstorm/task-matching";
import { hasCapability } from "@/lib/llm/capabilities";

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

  // Body is optional — clients that send only the locale header still work.
  let body: { modelConfigId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // No JSON body (or invalid): fall through with an empty object, which
    // leaves modelConfigId undefined → worker uses the default chat model.
  }
  const modelConfigId = typeof body.modelConfigId === "string" && body.modelConfigId.trim()
    ? body.modelConfigId.trim()
    : undefined;

  // Validate an explicitly chosen model: it must belong to the user AND be
  // chat-capable. This guards against stale client state pointing at a model
  // that was deleted, swapped to another user, or isn't chat-capable (e.g. an
  // embedding/rerank model id). On any mismatch we reject rather than silently
  // letting the worker fall back to the default — otherwise the user's
  // selection would be ignored without feedback.
  if (modelConfigId) {
    const chosen = await db.modelConfig.findUnique({
      where: { id: modelConfigId },
      include: { provider: true },
    });
    if (!chosen || chosen.provider.userId !== user.id) {
      return errorResponse({ code: "notFound", message: "Selected model not found" }, 404);
    }
    if (!hasCapability(chosen.capabilities, "chat")) {
      return errorResponse({ code: "invalidInput", message: "Selected model is not chat-capable" }, 400);
    }
  }

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
  const taskId = await queue.submit(
    "outline_generate",
    { sessionId: id, userId: user.id, locale, modelConfigId },
    user.id,
  );

  return successResponse({ taskId, status: "pending", progress: 0 }, 201);
}
