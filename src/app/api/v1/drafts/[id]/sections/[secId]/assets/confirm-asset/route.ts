import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;

  let body: { markerId: string; assetId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("Invalid request body", 400);
  }

  if (!body.markerId || !body.assetId) {
    return errorResponse("markerId and assetId are required", 400);
  }

  const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id } });
  if (!draft) return errorResponse("Draft not found", 404);

  const section = await db.section.findFirst({ where: { id: sectionId, draftId } });
  if (!section) return errorResponse("Section not found", 404);

  const asset = await db.sectionAsset.findFirst({
    where: { id: body.assetId, draftId, sectionId },
  });
  if (!asset) return errorResponse("Asset not found", 404);

  const content = section.content || "";
  const markerRe = new RegExp(
    `\\[(IMAGE_REQUEST|DIAGRAM_REQUEST):[\\s\\S]*?id=${body.markerId}[\\s\\S]*?\\]`
  );

  const isImageType = asset.type === "image" || asset.type === "mermaid" || asset.type === "svg";
  const replacement = isImageType
    ? `[IMAGE:${body.assetId}]`
    : `[DIAGRAM:${body.assetId}]`;

  const updatedContent = content.replace(markerRe, replacement);

  if (updatedContent === content) {
    return errorResponse("Marker not found in section content", 404);
  }

  await db.section.update({
    where: { id: sectionId },
    data: { content: updatedContent },
  });

  return successResponse({ success: true, content: updatedContent });
}
