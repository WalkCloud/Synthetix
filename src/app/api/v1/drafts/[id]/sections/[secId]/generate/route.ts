import { db } from "@/lib/db";
import { recordTokenUsageSafely } from "@/lib/llm/usage";
import { generateSectionStream } from "@/lib/writing/generator";
import { auditSection } from "@/lib/writing/auditor";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { persistSectionReferences } from "@/lib/writing/persist-references";
import { createAssetRequests } from "@/lib/writing/asset-pipeline";
import { buildEffectiveConstraints, mergeSectionConstraints, parseSectionConstraints } from "@/lib/writing/constraints";
import { sseEvent, sseDone, sseError } from "@/lib/writing/sse-events";
import { createOnceRecorder } from "@/lib/writing/once-recorder";
import { updateWikiAfterSection } from "@/lib/wiki/writer";
import {
  errorResponse,
  requireAuthUser,
  loadOwnedDraft,
  loadSectionInDraft,
} from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const auth = await requireAuthUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const { id: draftId, secId: sectionId } = await params;

  let body: { constraints?: { wordLimit?: number; additionalRequirements?: string }; modelAConfigId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const draft = await loadOwnedDraft(draftId, user.id);
  if (draft instanceof Response) return draft;

  const section = await loadSectionInDraft(sectionId, draftId);
  if (section instanceof Response) return section;

  const constraints = body.constraints
    ? { wordLimit: body.constraints.wordLimit, additionalRequirements: body.constraints.additionalRequirements }
    : undefined;
  const persistedConstraints = constraints?.additionalRequirements?.trim()
    ? mergeSectionConstraints(section.constraints, { additionalRequirements: constraints.additionalRequirements.trim() })
    : section.constraints;
  const sectionForGeneration = { ...section, constraints: persistedConstraints };

  const encoder = new TextEncoder();
  let fullContent = "";
  let inTokens = 0;
  let outTokens = 0;
  let modelConfigId = "";

  const tokenRecorder = createOnceRecorder(async () => {
    if (!modelConfigId) return;
    if (inTokens === 0 && outTokens === 0) return;
    await recordTokenUsageSafely({
      userId: user.id, modelConfigId, module: "writing",
      inputTokens: inTokens, outputTokens: outTokens,
    });
  });

  // Bridge client disconnect (request.signal) into the generation: if the
  // client goes away we abort the LLM stream so the worker doesn't keep
  // generating into the void. ReadableStream.cancel() also fires on disconnect.
  const disconnectController = new AbortController();
  const onAbort = () => disconnectController.abort();
  if (request.signal.aborted) disconnectController.abort();
  else request.signal.addEventListener("abort", onAbort, { once: true });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        await db.section.update({ where: { id: sectionId }, data: { status: "retrieving", constraints: persistedConstraints } });

        const completedSections = await db.section.findMany({
          where: { draftId, status: { in: ["locked", "summarized"] } },
          select: { title: true, summary: true, status: true },
          orderBy: { index: "asc" },
        });

        const result = await generateSectionStream(
          draft, sectionForGeneration, completedSections, user.id, constraints, body.modelAConfigId,
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

        const contentWithRequiredDiagram = stripLeadingSectionTitle(fullContent, section.title);
        const { diagrams, images, contentWithIds } = await createAssetRequests(
          draftId,
          sectionId,
          contentWithRequiredDiagram,
          sectionForGeneration,
          buildEffectiveConstraints(sectionForGeneration.constraints, constraints),
        );

        const finalContent = stripLeadingSectionTitle(contentWithIds, section.title);

        await db.section.update({
          where: { id: sectionId },
          data: {
            content: finalContent,
            contentA: null,
            contentB: null,
            modelA: null,
            modelB: null,
            selectedModel: null,
            wordCount: finalContent.split(/\s+/).filter(Boolean).length,
            status: "reviewing",
          },
        });

        const pendingCount = diagrams.length + images.length;
        if (pendingCount > 0) {
          controller.enqueue(encoder.encode(sseEvent("assets", { count: pendingCount, pending: true })));
        }

        await tokenRecorder.record();

        (async () => {
          try {
            const auditResult = await auditSection(section.title, contentWithRequiredDiagram, section.keyPoints, user.id, sectionId);
            const current = await db.section.findUnique({ where: { id: sectionId }, select: { constraints: true } });
            await db.section.update({
              where: { id: sectionId },
              data: { constraints: JSON.stringify({ ...parseSectionConstraints(current?.constraints), _audit: auditResult }) },
            });
          } catch (err) {
            console.error(`Background audit failed for section ${sectionId}:`, err);
          }
        })();

        // Wiki writeback flywheel: extract this section's new knowledge and
        // merge it back into the Wiki so subsequent sections benefit. Fire-and-
        // forget (non-blocking) — the section is already saved successfully.
        // Bumps confidence of Wiki entries that were cited in this section.
        const wikiEntryIds = (result as { wikiEntryIds?: string[] }).wikiEntryIds ?? [];
        void updateWikiAfterSection(
          { id: sectionId, title: section.title, content: finalContent },
          draftId,
          user.id,
          wikiEntryIds,
        ).catch((err) => {
          console.warn(`Wiki writeback failed for section ${sectionId} (non-blocking):`, err);
        });

        controller.enqueue(encoder.encode(sseDone()));
        controller.close();
      } catch (error) {
        await tokenRecorder.record();
        await db.section.update({
          where: { id: sectionId }, data: { status: "failed" },
        }).catch((err) => { console.warn("Failed to update section status:", err); });
        const message = error instanceof Error ? error.message : "Stream failed";
        try { controller.enqueue(encoder.encode(sseError(message))); } catch {}
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      // Client disconnected — abort any in-flight LLM stream so the worker
      // doesn't keep generating into the void.
      disconnectController.abort();
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
