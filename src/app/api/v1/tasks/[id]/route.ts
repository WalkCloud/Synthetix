import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";
import { parseTaskResult, parseTaskInput } from "@/lib/queue/task-json";

interface TaskData {
  id: string;
  type: string;
  status: string;
  progress: number;
  result: unknown;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const task = await db.asyncTask.findUnique({
    where: { id },
  });

  if (!task || task.userId !== user.id) {
    const response: ApiResponse = {
      success: false,
      error: "Task not found",
    };
    return NextResponse.json(response, { status: 404 });
  }

  const data: TaskData = {
    id: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    result: parseTaskResult<unknown>(task.resultData, null),
    error: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  const response: ApiResponse<TaskData> = {
    success: true,
    data,
  };
  return NextResponse.json(response);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const task = await db.asyncTask.findUnique({
    where: { id },
  });

  if (!task || task.userId !== user.id) {
    const response: ApiResponse = {
      success: false,
      error: "Task not found",
    };
    return NextResponse.json(response, { status: 404 });
  }

  if (task.status !== "pending" && task.status !== "running") {
    const response: ApiResponse = {
      success: false,
      error: `Cannot cancel task with status: ${task.status}`,
    };
    return NextResponse.json(response, { status: 400 });
  }

  const cancelled = await db.asyncTask.updateMany({
    where: { id, status: { in: ["pending", "running"] } },
    data: {
      status: "cancelled",
      errorMessage: "Cancelled by user",
      updatedAt: new Date(),
    },
  });
  if (cancelled.count === 0) {
    return NextResponse.json({
      success: false,
      error: "Task is no longer cancellable",
    }, { status: 409 });
  }

  // When a document_convert task is cancelled, reset the document's status
  // back to "pending". Otherwise the document stays in "converting"/"queued"
  // and recoverOrphanedPhaseOne (run on queue init / server restart) treats it
  // as a crashed-mid-processing doc and RESUBMITS it — defeating the
  // cancellation. Resetting to "pending" leaves it outside the recovery scan
  // (which only covers queued/converting/splitting) and is semantically
  // correct: the user can click "Start Processing" again to retry.
  if (task.type === "document_convert") {
    const input = parseTaskInput<{ docId?: string }>(task.inputData, {});
    if (input.docId) {
      await db.document.updateMany({
        where: { id: input.docId, userId: user.id, status: { in: ["queued", "converting", "splitting"] } },
        data: { status: "pending" },
      }).catch(() => undefined);
    }
  }

  const response: ApiResponse = {
    success: true,
    message: "Task cancelled",
  };
  return NextResponse.json(response);
}
