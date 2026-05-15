import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
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

  const asset = await db.sectionAsset.findFirst({
    where: { id: assetId, draftId, sectionId },
  });
  if (!asset || !asset.path || asset.status !== "ready") {
    return new Response("Not found", { status: 404 });
  }

  try {
    const filePath = getAssetFilePath(asset.path);
    const data = await fs.readFile(filePath);

    return new Response(data, {
      headers: {
        "Content-Type": asset.mimeType || "image/svg+xml",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}
