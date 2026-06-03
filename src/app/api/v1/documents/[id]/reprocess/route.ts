import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { getQueue } from "@/lib/queue";
import type { ProcessingOptions } from "@/lib/queue/types";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  let options: ProcessingOptions = {};
  try {
    const body = await request.json().catch(() => ({}));
    if (body.options) options = body.options as ProcessingOptions;
  } catch { /* ignore parse errors */ }

  await db.document.update({ where: { id }, data: { status: "uploading" } });
  await db.documentChunk.deleteMany({ where: { documentId: id } }).catch(() => {});

  const queue = getQueue();
  const taskId = await queue.submit("document_convert", { docId: doc.id, options }, user.id);

  return successResponse({ documentId: id, taskId });
}
