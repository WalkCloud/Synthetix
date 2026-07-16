import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { loadOwnedDraft } from "@/lib/api-helpers";
import { getAssetFilePath } from "@/lib/writing/diagram-generator";
import fs from "node:fs/promises";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; secId: string; assetId: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: draftId, secId: sectionId, assetId } = await params;

  const draft = await loadOwnedDraft(draftId, user.id, { id: true });
  if (draft instanceof Response) return draft;

  const asset = await db.sectionAsset.findFirst({
    where: { id: assetId, draftId, sectionId },
  });
  if (!asset || !asset.path || asset.status !== "ready") {
    return new Response("Not found", { status: 404 });
  }

  try {
    const filePath = getAssetFilePath(asset.path);
    const data = await fs.readFile(filePath);
    const etag = `"${asset.id}-${asset.updatedAt?.getTime() || Date.now()}"`;

    if (_request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { "ETag": etag } });
    }

    return new Response(data, {
      headers: {
        "Content-Type": asset.mimeType || "image/svg+xml",
        "Cache-Control": "no-cache, must-revalidate",
        "ETag": etag,
      },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}
