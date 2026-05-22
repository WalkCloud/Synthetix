import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { recordTokenUsage } from "@/lib/llm/usage";
import { generateSectionStream } from "@/lib/writing/generator";
import { auditSection } from "@/lib/writing/auditor";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { persistSectionReferences } from "@/lib/writing/persist-references";
import { createAssetRequests, generateAndPlaceAssetMarkers } from "@/lib/writing/asset-pipeline";
import { sseEvent, sseDone, sseError } from "@/lib/writing/sse-events";
import { authErrorResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;

  let body: { constraints?: { wordLimit?: number; additionalRequirements?: string }; modelAConfigId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id } });
  if (!draft) return errorResponse("Draft not found", 404);

  const section = await db.section.findFirst({ where: { id: sectionId, draftId } });
  if (!section) return errorResponse("Section not found", 404);

  const constraints = body.constraints
    ? { wordLimit: body.constraints.wordLimit, additionalRequirements: body.constraints.additionalRequirements }
    : undefined;

  const encoder = new TextEncoder();
  let fullContent = "";
  let inTokens = 0;
  let outTokens = 0;
  let modelConfigId = "";

  const readable = new ReadableStream({
    async start(controller) {
      try {
        await db.section.update({ where: { id: sectionId }, data: { status: "retrieving" } });

        const completedSections = await db.section.findMany({
          where: { draftId, status: { in: ["locked", "summarized"] } },
          select: { title: true, summary: true, status: true },
          orderBy: { index: "asc" },
        });

        const result = await generateSectionStream(
          draft, section, completedSections, user.id, constraints, body.modelAConfigId,
        );
        modelConfigId = result.modelConfigId;

        await persistSectionReferences(sectionId, result.ragReferences);
        await db.section.update({ where: { id: sectionId }, data: { status: "generating" } });
        controller.enqueue(encoder.encode(sseEvent("references", { references: result.ragReferences })));

        for await (const chunk of result.stream) {
          if (chunk.content) {
            fullContent += chunk.content;
            controller.enqueue(encoder.encode(sseEvent("chunk", { content: chunk.content })));
          }
          if (chunk.reasoning) {
            controller.enqueue(encoder.encode(sseEvent("reasoning", { content: chunk.reasoning })));
          }
          if (chunk.inputTokens) inTokens = chunk.inputTokens;
          if (chunk.outputTokens) outTokens = chunk.outputTokens;
        }

        const cleanContent = stripLeadingSectionTitle(fullContent, section.title);
        const { diagrams, images } = await createAssetRequests(draftId, sectionId, fullContent);

        await db.section.update({
          where: { id: sectionId },
          data: {
            content: cleanContent,
            wordCount: cleanContent.split(/\s+/).filter(Boolean).length,
            status: "reviewing",
          },
        });

        let assetCount = 0;
        if (diagrams.length > 0 || images.length > 0) {
          try {
            assetCount = await generateAndPlaceAssetMarkers(draftId, sectionId, section.title, fullContent);
          } catch (genErr) {
            console.error(`[generate] asset generation failed:`, genErr);
          }
        }

        if (assetCount > 0) {
          controller.enqueue(encoder.encode(sseEvent("assets", { count: assetCount })));
        }

        await recordTokenUsage({
          userId: user.id, modelConfigId, module: "writing",
          inputTokens: inTokens, outputTokens: outTokens,
        }).catch((err) => { console.warn("Failed to record token usage:", err); });

        (async () => {
          try {
            const auditResult = await auditSection(section.title, cleanContent, section.keyPoints);
            const current = await db.section.findUnique({ where: { id: sectionId }, select: { constraints: true } });
            const existing = current?.constraints ? JSON.parse(current.constraints) : {};
            await db.section.update({
              where: { id: sectionId },
              data: { constraints: JSON.stringify({ ...existing, _audit: auditResult }) },
            });
          } catch (err) {
            console.error(`Background audit failed for section ${sectionId}:`, err);
          }
        })();

        controller.enqueue(encoder.encode(sseDone()));
        controller.close();
      } catch (error) {
        await db.section.update({
          where: { id: sectionId }, data: { status: "failed" },
        }).catch((err) => { console.warn("Failed to update section status:", err); });
        const message = error instanceof Error ? error.message : "Stream failed";
        try { controller.enqueue(encoder.encode(sseError(message))); } catch {}
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
