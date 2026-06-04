import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import path from "node:path";
import fs from "node:fs/promises";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "sections");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
  }

  const section = await db.section.findFirst({
    where: { id: sectionId, draftId },
    select: { id: true },
  });
  if (!section) {
    return errorResponse({ code: "sectionNotFound", message: "Section not found" }, 404);
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const replaceAssetId = formData.get("replaceAssetId") as string | null;

  if (!file || !(file instanceof File)) {
    return errorResponse({ code: "noFileProvided", message: "No file provided" }, 400);
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_FILE_SIZE) {
    return errorResponse(`File too large. Maximum size is 10MB`, 400);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const allowedExts = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
  if (!allowedExts.includes(ext)) {
    return errorResponse(`Unsupported format: .${ext}`, 400);
  }

  const mimeType = file.type || `image/${ext === "jpg" ? "jpeg" : ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const sectionDir = path.join(ASSETS_DIR, sectionId);
  await fs.mkdir(sectionDir, { recursive: true });

  const sanitizedTitle = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "-").slice(0, 40);
  const filename = `imported-${sanitizedTitle}-${Date.now()}.${ext}`;
  const filePath = path.join(sectionDir, filename);
  await fs.writeFile(filePath, buffer);
  const relativePath = `assets/sections/${sectionId}/${filename}`;

  let assetId: string;

  if (replaceAssetId) {
    const existing = await db.sectionAsset.findFirst({
      where: { id: replaceAssetId, draftId, sectionId },
    });
    if (!existing) {
      return errorResponse({ code: "notFound", message: "Target asset not found" }, 404);
    }

    if (existing.path) {
      const oldPath = path.join(/* turbopackIgnore: true */ process.cwd(), existing.path);
      await fs.unlink(oldPath).catch(() => {});
    }

    await db.sectionAsset.update({
      where: { id: replaceAssetId },
      data: {
        type: "image",
        title: file.name.replace(/\.[^.]+$/, ""),
        path: relativePath,
        mimeType,
        status: "ready",
        prompt: null,
        metadata: JSON.stringify({ importedAt: new Date().toISOString(), originalName: file.name }),
      },
    });
    assetId = replaceAssetId;
  } else {
    const asset = await db.sectionAsset.create({
      data: {
        draftId,
        sectionId,
        type: "image",
        title: file.name.replace(/\.[^.]+$/, ""),
        path: relativePath,
        mimeType,
        status: "ready",
        metadata: JSON.stringify({ importedAt: new Date().toISOString(), originalName: file.name }),
      },
    });
    assetId = asset.id;

    const sectionContent = await db.section.findUnique({
      where: { id: sectionId },
      select: { content: true },
    });
    if (sectionContent?.content) {
      const marker = `[IMAGE:${assetId}]`;
      if (!sectionContent.content.includes(marker)) {
        await db.section.update({
          where: { id: sectionId },
          data: { content: sectionContent.content + "\n\n" + marker },
        });
      }
    }
  }

  return successResponse({ assetId, path: relativePath, status: "ready", mode: replaceAssetId ? "replaced" : "created" });
}
