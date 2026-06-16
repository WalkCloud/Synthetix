import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { getQueue } from "@/lib/queue";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

interface GenerateAllBody {
  overwrite?: boolean;
  stopOnError?: boolean;
  modelConfigId?: string;
}

const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

function taskMatchesDraft(inputData: string | null, draftId: string): boolean {
  if (!inputData) return false;
  try {
    const parsed = JSON.parse(inputData) as { draftId?: string };
    return parsed.draftId === draftId;
  } catch {
    return false;
  }
}

async function resetOrphanedDraftSections(draftId: string): Promise<void> {
  await db.section.updateMany({
    where: {
      draftId,
      status: { in: ["retrieving", "generating"] },
      content: null,
    },
    data: { status: "pending" },
  });

  await db.section.updateMany({
    where: {
      draftId,
      status: { in: ["retrieving", "generating"] },
      content: { not: null },
    },
    data: { status: "reviewing" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId } = await params;

  let body: GenerateAllBody;
  try {
    body = (await request.json()) as GenerateAllBody;
  } catch {
    body = {};
  }

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
  }

  const activeTasks = await db.asyncTask.findMany({
    where: {
      userId: user.id,
      type: "draft_generate_all",
      status: { in: ["pending", "running"] },
    },
    select: { id: true, status: true, progress: true, inputData: true, updatedAt: true },
  });

  const now = Date.now();
  const existing = activeTasks.find((task) => taskMatchesDraft(task.inputData, draftId));
  if (existing) {
    const elapsed = now - new Date(existing.updatedAt).getTime();
    if (existing.status === "running" && elapsed > STALE_RUNNING_MS) {
      await db.asyncTask.update({
        where: { id: existing.id },
        data: {
          status: "failed",
          errorMessage: "Generation task became stale. Start again to resume from unfinished sections.",
          updatedAt: new Date(),
        },
      });
      await resetOrphanedDraftSections(draftId);
    } else {
      return successResponse({
        taskId: existing.id,
        status: existing.status,
        progress: existing.progress,
      });
    }
  }

  await resetOrphanedDraftSections(draftId);

  const queue = getQueue();
  const taskId = await queue.submit(
    "draft_generate_all",
    {
      draftId,
      userId: user.id,
      overwrite: body.overwrite === true,
      stopOnError: body.stopOnError !== false,
      modelConfigId: body.modelConfigId,
    },
    user.id,
  );

  return successResponse({ taskId, status: "pending", progress: 0 }, 201);
}
