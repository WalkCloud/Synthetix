import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import path from "node:path";
import fs from "node:fs/promises";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { renderDiagramFromCode } from "@/lib/writing/diagram-parse";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "sections");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;
  const body = await request.json();
  const { code, title, replaceAssetId } = body as { code?: string; title?: string; replaceAssetId?: string };

  if (!code || !code.trim()) return errorResponse("Diagram code is required", 400);

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) return errorResponse("Draft not found", 404);

  try {
    const svg = renderDiagramFromCode(code.trim(), title);
    const trimmedCode = code.trim();
    const jsonInput = trimmedCode.startsWith("{");

    const sectionDir = path.join(ASSETS_DIR, sectionId);
    await fs.mkdir(sectionDir, { recursive: true });

    const sanitizedTitle = (title || "diagram")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
    const filename = `diagram-${sanitizedTitle}.svg`;
    const filePath = path.join(sectionDir, filename);
    await fs.writeFile(filePath, svg, "utf-8");
    const relativePath = `assets/sections/${sectionId}/${filename}`;

    let assetId: string;

    if (replaceAssetId) {
      const existing = await db.sectionAsset.findFirst({
        where: { id: replaceAssetId, draftId, sectionId },
      });
      if (!existing) return errorResponse("Target asset not found", 404);
      await db.sectionAsset.update({
        where: { id: replaceAssetId },
        data: {
          type: "mermaid", title: title || existing.title, path: relativePath,
          mimeType: "image/svg+xml", status: "ready", prompt: trimmedCode,
          metadata: JSON.stringify({ renderedAt: new Date().toISOString(), format: jsonInput ? "json" : "mermaid" }),
        },
      });
      assetId = replaceAssetId;
    } else {
      const asset = await db.sectionAsset.create({
        data: {
          draftId, sectionId, type: "mermaid", title: title || "Diagram", path: relativePath,
          mimeType: "image/svg+xml", status: "ready", prompt: trimmedCode,
          metadata: JSON.stringify({ format: jsonInput ? "json" : "mermaid" }),
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
  } catch (error) {
    return errorResponse(error);
  }
}
