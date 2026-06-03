import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { generateDiagramAsset } from "@/lib/writing/diagram-generator";
import { sseEvent, sseDone, sseError } from "@/lib/writing/sse-events";
import { authErrorResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;

  let body: { markerIds?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id } });
  if (!draft) return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);

  const section = await db.section.findFirst({ where: { id: sectionId, draftId } });
  if (!section) return errorResponse({ code: "sectionNotFound", message: "Section not found" }, 404);

  let assets = await db.sectionAsset.findMany({
    where: { sectionId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (body.markerIds && body.markerIds.length > 0) {
    const markerIdSet = new Set(body.markerIds);
    assets = assets.filter((a) => {
      try {
        const meta = a.metadata ? JSON.parse(a.metadata) : {};
        return markerIdSet.has(meta.markerId);
      } catch {
        return false;
      }
    });
  }

  if (assets.length === 0) {
    return errorResponse({ code: "notFound", message: "No pending assets found" }, 404);
  }

  const encoder = new TextEncoder();
  let succeeded = 0;
  let failed = 0;

  const readable = new ReadableStream({
    async start(controller) {
      for (const asset of assets) {
        try {
          controller.enqueue(encoder.encode(sseEvent("progress", {
            stage: "generating",
            assetId: asset.id,
            type: asset.type,
          })));

          const result = await generateDiagramAsset(asset.id, user.id);

          if (result.success) {
            succeeded++;
            const serveUrl = `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${asset.id}/serve`;
            controller.enqueue(encoder.encode(sseEvent("complete", {
              assetId: asset.id,
              url: serveUrl,
              type: asset.type,
            })));
          } else {
            failed++;
            controller.enqueue(encoder.encode(sseError(`Asset ${asset.id}: ${result.error || "Generation failed"}`)));
          }
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : "Unknown error";
          controller.enqueue(encoder.encode(sseError(`Asset ${asset.id}: ${message}`)));
        }
      }

      controller.enqueue(encoder.encode(sseEvent("summary", {
        total: assets.length,
        succeeded,
        failed,
      })));
      controller.enqueue(encoder.encode(sseDone()));
      controller.close();
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
