import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: docId } = await params;

  const doc = await db.document.findFirst({
    where: { id: docId, userId: user.id },
    select: { id: true },
  });
  if (!doc) return errorResponse({ code: "documentNotFound", message: "Document not found" }, 404);

  const images = await db.documentImage.findMany({
    where: { documentId: docId },
    orderBy: { createdAt: "asc" },
  });

  const result = images.map((img) => ({
    id: img.id,
    filename: img.filename,
    altText: img.altText,
    mimeType: img.mimeType,
    fileSize: img.fileSize,
    width: img.width,
    height: img.height,
    pageNumber: img.pageNumber,
    url: `/api/v1/documents/${docId}/images/${img.filename}`,
    createdAt: img.createdAt,
  }));

  return successResponse({ images: result });
}
