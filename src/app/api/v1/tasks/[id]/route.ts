import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { ApiResponse } from "@/types/api";

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
  const { id } = await params;

  const task = await db.asyncTask.findUnique({
    where: { id },
  });

  if (!task) {
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
    result: task.resultData ? JSON.parse(task.resultData) : null,
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
  const { id } = await params;

  const task = await db.asyncTask.findUnique({
    where: { id },
  });

  if (!task) {
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

  await db.asyncTask.update({
    where: { id },
    data: {
      status: "cancelled",
      updatedAt: new Date(),
    },
  });

  const response: ApiResponse = {
    success: true,
    message: "Task cancelled",
  };
  return NextResponse.json(response);
}
