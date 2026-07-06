import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsageSafely } from "@/lib/llm/usage";
import { compareSectionStream } from "@/lib/writing/generator";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { persistSectionReferences } from "@/lib/writing/persist-references";
import { resolveModelOrFallback, resolveSecondModel } from "@/lib/writing/resolve-models";
import { mergeSectionConstraints } from "@/lib/writing/constraints";
import { sseEvent, sseDone, sseError } from "@/lib/writing/sse-events";
import { authErrorResponse, errorResponse } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;

  let body: {
    constraints?: { wordLimit?: number; additionalRequirements?: string };
    modelAConfigId?: string;
    modelBConfigId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
  });
  if (!draft) {
    return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
  }

  const section = await db.section.findFirst({
    where: { id: sectionId, draftId },
  });
  if (!section) {
    return errorResponse({ code: "sectionNotFound", message: "Section not found" }, 404);
  }

  const modelARecord = await resolveModelOrFallback(body.modelAConfigId, "writing", user.id);
  const modelBRecord = body.modelBConfigId
    ? await resolveModelOrFallback(body.modelBConfigId, "writing", user.id)
    : await resolveSecondModel(modelARecord.id, user.id);
  if (modelBRecord.id === modelARecord.id) {
    return errorResponse("Please select two different models for comparison", 400);
  }

  await db.section.update({
    where: { id: sectionId },
    data: { status: "retrieving" },
  });

  const completedSections = await db.section.findMany({
    where: { draftId, status: { in: ["locked", "summarized"] } },
    select: { title: true, summary: true, status: true },
    orderBy: { index: "asc" },
  });

  const modelAProvider = createLLMProvider({
    apiBaseUrl: modelARecord.provider.apiBaseUrl,
    apiKey: modelARecord.provider.apiKey,
    providerType: modelARecord.provider.providerType,
  });
  const modelBProvider = createLLMProvider({
    apiBaseUrl: modelBRecord.provider.apiBaseUrl,
    apiKey: modelBRecord.provider.apiKey,
    providerType: modelBRecord.provider.providerType,
  });

  const constraints = body.constraints
    ? { wordLimit: body.constraints.wordLimit, additionalRequirements: body.constraints.additionalRequirements }
    : undefined;
  const persistedConstraints = constraints?.additionalRequirements?.trim()
    ? mergeSectionConstraints(section.constraints, { additionalRequirements: constraints.additionalRequirements.trim() })
    : section.constraints;
  const sectionForGeneration = { ...section, constraints: persistedConstraints };

  const encoder = new TextEncoder();
  let contentA = "";
  let contentB = "";
  let modelA = "";
  let modelB = "";
  let inputTokensA = 0;
  let outputTokensA = 0;
  let inputTokensB = 0;
  let outputTokensB = 0;
  let ragRefs: { documentId?: string; chunkId?: string; documentName: string; title?: string | null; content: string; score: number }[] = [];

  const readable = new ReadableStream({
    async start(controller) {
      try {
        await db.section.update({ where: { id: sectionId }, data: { status: "comparing", constraints: persistedConstraints } });

        await compareSectionStream(
          draft, sectionForGeneration, completedSections, user.id,
          { provider: modelAProvider, modelId: modelARecord.modelId, modelConfigId: modelARecord.id },
          { provider: modelBProvider, modelId: modelBRecord.modelId, modelConfigId: modelBRecord.id },
          constraints,
          {
            onReferences(refs) {
              ragRefs = refs;
              controller.enqueue(encoder.encode(sseEvent("references", { references: refs })));
            },
            onChunk(source, content) {
              controller.enqueue(encoder.encode(sseEvent("chunk", { source, content })));
            },
            onDone(result) {
              contentA = result.contentA;
              contentB = result.contentB;
              modelA = result.modelA;
              modelB = result.modelB;
              inputTokensA = result.inputTokensA;
              outputTokensA = result.outputTokensA;
              inputTokensB = result.inputTokensB;
              outputTokensB = result.outputTokensB;
            },
            onError(source, error) {
              controller.enqueue(encoder.encode(sseEvent("model_error", { source, error })));
            },
          },
        );

        if (contentA || contentB) {
          await persistSectionReferences(sectionId, ragRefs);
          await Promise.all([
            recordTokenUsageSafely({
              userId: user.id, modelConfigId: modelARecord.id, module: "comparison",
              inputTokens: inputTokensA, outputTokens: outputTokensA, referenceId: sectionId,
            }),
            recordTokenUsageSafely({
              userId: user.id, modelConfigId: modelBRecord.id, module: "comparison",
              inputTokens: inputTokensB, outputTokens: outputTokensB, referenceId: sectionId,
            }),
          ]);

          await db.section.update({
            where: { id: sectionId },
            data: {
              content: null,
              contentA: stripLeadingSectionTitle(contentA, section.title),
              contentB: stripLeadingSectionTitle(contentB, section.title),
              modelA,
              modelB,
              selectedModel: null,
              wordCount: null,
              status: "reviewing",
            },
          });
        }

        controller.enqueue(encoder.encode(sseDone()));
        controller.close();
      } catch (error) {
        const tokenPromises: Promise<void>[] = [];
        if (modelARecord.id && (inputTokensA > 0 || outputTokensA > 0)) {
          tokenPromises.push(recordTokenUsageSafely({
            userId: user.id, modelConfigId: modelARecord.id, module: "comparison",
            inputTokens: inputTokensA, outputTokens: outputTokensA, referenceId: sectionId,
          }));
        }
        if (modelBRecord.id && (inputTokensB > 0 || outputTokensB > 0)) {
          tokenPromises.push(recordTokenUsageSafely({
            userId: user.id, modelConfigId: modelBRecord.id, module: "comparison",
            inputTokens: inputTokensB, outputTokens: outputTokensB, referenceId: sectionId,
          }));
        }
        await Promise.all(tokenPromises);
        try {
          await db.section.update({
            where: { id: sectionId }, data: { status: "failed" },
          });
        } catch {}
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
