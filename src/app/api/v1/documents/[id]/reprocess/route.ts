import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { getQueue } from "@/lib/queue";
import type { ProcessingOptions } from "@/lib/queue/types";
import type { ApiResponse } from "@/types/api";

export async function POST(
  request: Request,
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

  // Load original processing options from the last successful task
  let options: ProcessingOptions = {};
  try {
    const body = await request.json().catch(() => ({}));
    if (body.options) options = body.options as ProcessingOptions;
  } catch { /* ignore parse errors */ }

  await db.document.update({ where: { id }, data: { status: "uploading" } });
  await db.documentChunk.deleteMany({ where: { documentId: id } }).catch(() => {});

  const queue = getQueue();
  const taskId = await queue.submit("document_convert", { docId: doc.id, options }, user.id);

  return NextResponse.json({
    success: true,
    data: { documentId: id, taskId },
  });
}
