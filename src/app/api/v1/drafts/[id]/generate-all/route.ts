import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { getQueue } from "@/lib/queue";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";
import { findTasksByResourceIdentity } from "@/lib/queue/task-identity-query";

interface GenerateAllBody {
  overwrite?: boolean;
  stopOnError?: boolean;
  modelConfigId?: string;
}

const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

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

  const existing = (await findTasksByResourceIdentity({
    userId: user.id,
    field: "draftId",
    value: draftId,
    types: ["draft_generate_all"],
    statuses: ["pending", "running"],
    order: "desc",
    take: 1,
  }))[0] ?? null;

  const now = Date.now();
  if (existing) {
    const elapsed = now - new Date(existing.updatedAt).getTime();
    if (existing.status === "running" && elapsed > STALE_RUNNING_MS) {
      const failed = await db.asyncTask.updateMany({
        where: { id: existing.id, status: "running" },
        data: {
          status: "failed",
          errorMessage: "Generation task became stale. Start again to resume from unfinished sections.",
          updatedAt: new Date(),
        },
      });
      if (failed.count === 1) {
        await resetOrphanedDraftSections(draftId);
      } else {
        const current = await db.asyncTask.findUnique({
          where: { id: existing.id },
          select: { status: true, progress: true },
        });
        if (current) {
          return successResponse({
            taskId: existing.id,
            status: current.status,
            progress: current.progress,
          });
        }
      }
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
