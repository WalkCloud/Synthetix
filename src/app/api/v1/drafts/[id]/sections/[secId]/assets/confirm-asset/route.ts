import { db } from "@/lib/db";
import {
  errorResponse,
  successResponse,
  requireAuthUser,
  loadOwnedDraft,
  loadSectionInDraft,
} from "@/lib/api-helpers";
import { replaceMarkerWithAsset } from "@/lib/writing/marker-parser";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const auth = await requireAuthUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const { id: draftId, secId: sectionId } = await params;

  let body: { markerId: string; assetId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse({ code: "invalidInput", message: "Invalid request body" }, 400);
  }

  if (!body.markerId || !body.assetId) {
    return errorResponse({ code: "invalidInput", message: "markerId and assetId are required" }, 400);
  }

  const draft = await loadOwnedDraft<{ id: string }>(draftId, user.id, { id: true });
  if (draft instanceof Response) return draft;

  const section = await loadSectionInDraft<{ id: string; content: string | null }>(sectionId, draftId);  if (section instanceof Response) return section;

  const asset = await db.sectionAsset.findFirst({
    where: { id: body.assetId, draftId, sectionId },
  });
  if (!asset) {
    return errorResponse({ code: "notFound", message: "Asset not found" }, 404);
  }

  const content = section.content || "";

  const result = replaceMarkerWithAsset(content, {
    markerId: body.markerId,
    assetId: body.assetId,
    assetType: asset.type,
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return errorResponse(`Marker not found: ${body.markerId}`, 404);
    }
    // reason === "unchanged"
    console.error("[confirm-asset] marker replacement unchanged", { markerId: body.markerId, assetId: body.assetId });
    return errorResponse({ code: "notFound", message: "Marker replacement failed" }, 404);
  }

  await db.section.update({
    where: { id: sectionId },
    data: { content: result.content },
  });

  return successResponse({ success: true, content: result.content });
}
