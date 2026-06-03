import path from "node:path";
import fs from "node:fs/promises";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { renderDiagramSvg } from "@/lib/writing/diagram-renderer";
import { buildSpecFromStructuredJson } from "@/lib/writing/diagram-spec";
import { sseEvent, sseDone, sseError } from "@/lib/writing/sse-events";
import { authErrorResponse, errorResponse } from "@/lib/api-helpers";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "sections");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;

  let body: {
    markerId?: string;
    type?: string;
    title?: string;
    style?: string;
    nodes?: { id: string; label: string; shape?: string; typeLabel?: string; sublabel?: string; componentType?: string }[];
    arrows?: { from: string; to: string; label?: string; flow?: string; dashed?: boolean }[];
    containers?: { id: string; label: string; subtitle?: string; sideLabel?: string; nodeIds: string[]; containerType?: string }[];
    summaryCards?: { title: string; content: string }[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body.title) return errorResponse({ code: "invalidInput", message: "Title is required" }, 400);

  const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id } });
  if (!draft) return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);

  const section = await db.section.findFirst({ where: { id: sectionId, draftId } });
  if (!section) return errorResponse({ code: "sectionNotFound", message: "Section not found" }, 404);

  const asset = await db.sectionAsset.create({
    data: {
      draftId,
      sectionId,
      type: "diagram",
      title: body.title,
      status: "pending",
      metadata: JSON.stringify({
        markerId: body.markerId,
        diagramType: body.type,
      }),
    },
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseEvent("progress", { stage: "building_spec" })));

        const spec = buildSpecFromStructuredJson({
          type: body.type,
          title: body.title,
          style: body.style,
          nodes: body.nodes,
          arrows: body.arrows,
          containers: body.containers,
        });

        controller.enqueue(encoder.encode(sseEvent("progress", { stage: "rendering_svg" })));

        const svg = renderDiagramSvg(spec);

        const sectionDir = path.join(ASSETS_DIR, sectionId);
        await fs.mkdir(sectionDir, { recursive: true });

        const sanitizedTitle = (body.title ?? "untitled")
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 40);
        const filename = `diagram-${sanitizedTitle}.svg`;
        await fs.writeFile(path.join(sectionDir, filename), svg, "utf-8");

        const relativePath = `assets/sections/${sectionId}/${filename}`;

        const metadata: Record<string, unknown> = {
          markerId: body.markerId,
          generatedAt: new Date().toISOString(),
        };
        if (body.summaryCards) {
          metadata.summaryCards = body.summaryCards;
        }

        await db.sectionAsset.update({
          where: { id: asset.id },
          data: {
            status: "ready",
            path: relativePath,
            mimeType: "image/svg+xml",
            metadata: JSON.stringify(metadata),
          },
        });

        const serveUrl = `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${asset.id}/serve`;
        controller.enqueue(encoder.encode(sseEvent("complete", {
          assetId: asset.id,
          url: serveUrl,
          mimeType: "image/svg+xml",
        })));

        controller.enqueue(encoder.encode(sseDone()));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Diagram generation failed";
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
