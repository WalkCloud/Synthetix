import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { generateImageAsset } from "@/lib/writing/image-generator";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;
  const body = await request.json();
  const { prompt, title, replaceAssetId } = body as {
    prompt?: string;
    title?: string;
    replaceAssetId?: string;
  };

  if (!prompt || !prompt.trim()) {
    return errorResponse("Prompt is required", 400);
  }

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return errorResponse("Draft not found", 404);
  }

  const section = await db.section.findFirst({
    where: { id: sectionId, draftId },
    select: { id: true },
  });
  if (!section) {
    return errorResponse("Section not found", 404);
  }

  if (replaceAssetId) {
    const existing = await db.sectionAsset.findFirst({
      where: { id: replaceAssetId, draftId, sectionId },
    });
    if (!existing) {
      return errorResponse("Target asset not found", 404);
    }

    const prevMeta = existing.metadata ? JSON.parse(existing.metadata) : {};
    const prevPrompt = prevMeta.imagePrompt || "";
    const enrichedPrompt = prevPrompt
      ? `${prompt}\n\n[Context: This is a modification of a previous image. Original description: ${prevPrompt}]`
      : prompt;

    await db.sectionAsset.update({
      where: { id: replaceAssetId },
      data: {
        type: "image",
        title: title || existing.title,
        description: enrichedPrompt.slice(0, 200),
        prompt: `[IMAGE_REQUEST:\nprompt=${enrichedPrompt}\ntitle=${title || existing.title}\n]`,
        status: "pending",
        path: null,
        mimeType: null,
        metadata: JSON.stringify({ imagePrompt: enrichedPrompt, prevPrompt, replacedAt: new Date().toISOString() }),
      },
    });

    const result = await generateImageAsset(replaceAssetId);

    if (!result.success) {
      return errorResponse(result.error);
    }

    return successResponse({ assetId: replaceAssetId, path: result.path, status: "ready", mode: "replaced" });
  }

  const asset = await db.sectionAsset.create({
    data: {
      draftId,
      sectionId,
      type: "image",
      title: title || prompt.slice(0, 50),
      description: prompt.slice(0, 200),
      prompt: `[IMAGE_REQUEST:\nprompt=${prompt}\ntitle=${title || prompt.slice(0, 50)}\n]`,
      status: "pending",
      metadata: JSON.stringify({ imagePrompt: prompt }),
    },
  });

  const result = await generateImageAsset(asset.id);

  if (!result.success) {
    return errorResponse(result.error);
  }

  const sectionContent = await db.section.findUnique({
    where: { id: sectionId },
    select: { content: true },
  });

  if (sectionContent?.content) {
    const marker = `[IMAGE:${asset.id}]`;
    if (!sectionContent.content.includes(marker)) {
      await db.section.update({
        where: { id: sectionId },
        data: {
          content: sectionContent.content + "\n\n" + marker,
        },
      });
    }
  }

  return successResponse({ assetId: asset.id, path: result.path, status: "ready", mode: "created" });
}
