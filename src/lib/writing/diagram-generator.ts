import path from "node:path";
import fs from "node:fs/promises";
import { db } from "@/lib/db";
import { buildSpecFromRawPrompt } from "@/lib/writing/diagram-spec";
import { renderDiagramSvg } from "@/lib/writing/diagram-renderer";
import { generateImageAsset } from "@/lib/writing/image-generator";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "sections");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function generateDiagramAsset(assetId: string, userId?: string): Promise<{
  success: boolean;
  path?: string;
  error?: string;
}> {
  const asset = await db.sectionAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    return { success: false, error: "Asset not found" };
  }

  if (asset.type === "image") {
    return generateImageAsset(assetId, userId);
  }

  if (asset.type !== "diagram" && asset.type !== "svg") {
    return { success: false, error: `Unsupported asset type: ${asset.type}` };
  }

  await db.sectionAsset.update({
    where: { id: assetId },
    data: { status: "generating" },
  });

  try {
    const rawPrompt = asset.prompt || "";
    const spec = buildSpecFromRawPrompt(rawPrompt);
    const svg = renderDiagramSvg(spec);

    const sectionDir = path.join(ASSETS_DIR, asset.sectionId);
    await ensureDir(sectionDir);

    const sanitizedTitle = spec.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
    const filename = `diagram-${sanitizedTitle}.svg`;
    const filePath = path.join(sectionDir, filename);

    await fs.writeFile(filePath, svg, "utf-8");

    const relativePath = `assets/sections/${asset.sectionId}/${filename}`;

    await db.sectionAsset.update({
      where: { id: assetId },
      data: {
        path: relativePath,
        mimeType: "image/svg+xml",
        status: "ready",
        metadata: JSON.stringify({
          ...(asset.metadata ? JSON.parse(asset.metadata) : {}),
          spec,
          generatedAt: new Date().toISOString(),
        }),
      },
    });

    return { success: true, path: relativePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.sectionAsset.update({
      where: { id: assetId },
      data: {
        status: "failed",
        metadata: JSON.stringify({
          ...(asset.metadata ? JSON.parse(asset.metadata) : {}),
          error: message,
          failedAt: new Date().toISOString(),
        }),
      },
    });
    return { success: false, error: message };
  }
}

export function getAssetFilePath(relativePath: string): string {
  return path.join(process.cwd(), "data", relativePath);
}
