import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  await db.document.update({ where: { id }, data: { status: "uploading" } });

  const task = await db.asyncTask.create({
    data: {
      userId: user.id,
      type: "document_convert",
      status: "pending",
      inputData: JSON.stringify({ docId: doc.id }),
    },
  });

  return NextResponse.json({
    success: true,
    data: { documentId: id, taskId: task.id },
  });
}
