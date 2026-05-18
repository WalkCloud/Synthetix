import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { generateDiagramAsset } from "@/lib/writing/diagram-generator";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; secId: string; assetId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId, assetId } = await params;

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return errorResponse("Draft not found", 404);
  }

  const asset = await db.sectionAsset.findFirst({
    where: { id: assetId, draftId, sectionId },
  });
  if (!asset) {
    return errorResponse("Asset not found", 404);
  }

  const result = await generateDiagramAsset(assetId);

  if (!result.success) {
    return errorResponse(result.error);
  }

  return successResponse({ assetId, path: result.path, status: "ready" });
}
