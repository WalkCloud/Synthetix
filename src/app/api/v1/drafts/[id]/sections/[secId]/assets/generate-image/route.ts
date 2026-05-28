import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { generateImageAsset } from "@/lib/writing/image-generator";
import { sseEvent, sseDone, sseError } from "@/lib/writing/sse-events";
import { authErrorResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;

  let body: { markerId?: string; prompt?: string; size?: string; style?: string; modelConfigId?: string; title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body.prompt) return errorResponse("Prompt is required", 400);

  const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id } });
  if (!draft) return errorResponse("Draft not found", 404);

  const section = await db.section.findFirst({ where: { id: sectionId, draftId } });
  if (!section) return errorResponse("Section not found", 404);

  const asset = await db.sectionAsset.create({
    data: {
      draftId,
      sectionId,
      type: "image",
      title: body.title || "Image",
      description: body.prompt.slice(0, 200),
      prompt: body.prompt,
      status: "pending",
      metadata: JSON.stringify({
        markerId: body.markerId,
        imagePrompt: body.prompt,
        size: body.size,
        style: body.style,
      }),
    },
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseEvent("progress", { stage: "calling_api" })));

        const result = await generateImageAsset(asset.id);

        if (result.success) {
          const serveUrl = `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${asset.id}/serve`;
          controller.enqueue(encoder.encode(sseEvent("complete", {
            assetId: asset.id,
            url: serveUrl,
            mimeType: "image/png",
          })));
        } else {
          controller.enqueue(encoder.encode(sseError(result.error || "Image generation failed")));
        }

        controller.enqueue(encoder.encode(sseDone()));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image generation failed";
        try { controller.enqueue(encoder.encode(sseError(message))); } catch {}
        try { controller.enqueue(encoder.encode(sseDone())); } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
