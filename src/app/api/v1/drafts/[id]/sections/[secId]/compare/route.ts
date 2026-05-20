import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { compareSection } from "@/lib/writing/generator";
import { semanticSearch } from "@/lib/search/semantic";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
  getErrorMessage,
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

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
    });
    if (!draft) {
      return errorResponse("Draft not found", 404);
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, draftId },
    });
    if (!section) {
      return errorResponse("Section not found", 404);
    }

    let modelARecord = null;
    if (body.modelAConfigId) {
      modelARecord = await db.modelConfig.findUnique({ where: { id: body.modelAConfigId }, include: { provider: true } });
    }
    if (!modelARecord) {
      modelARecord = await resolveModel("writing");
    }
    if (!modelARecord?.provider) {
      return errorResponse("No default writing model configured. Set a default writing model in settings.", 400);
    }

    let modelBRecord = null;
    if (body.modelBConfigId) {
      modelBRecord = await db.modelConfig.findUnique({ where: { id: body.modelBConfigId }, include: { provider: true } });
    }
    if (!modelBRecord) {
      modelBRecord = await db.modelConfig.findFirst({
        where: {
          id: { not: modelARecord.id },
          capabilities: { contains: "chat" },
        },
        include: { provider: true },
      });
    }
    if (!modelBRecord?.provider) {
      return errorResponse("No second model available for comparison. Add another chat-capable model in settings.", 400);
    }

    await db.section.update({
      where: { id: sectionId },
      data: { status: "retrieving" },
    });

    const searchQuery = [section.title, section.description].filter(Boolean).join(" ");
    const references = await semanticSearch(searchQuery, user.id, 5);

    await db.sectionReference.deleteMany({ where: { sectionId } });
    if (references.length > 0) {
      await db.sectionReference.createMany({
        data: references.map((ref) => ({
          sectionId,
          documentId: ref.documentId || null,
          chunkId: ref.chunkId || null,
          documentName: ref.documentName,
          relevanceScore: ref.score,
          sourceAnchor: ref.title || null,
        })),
      });
    }

    await db.section.update({
      where: { id: sectionId },
      data: { status: "comparing" },
    });

    const completedSections = await db.section.findMany({
      where: {
        draftId,
        status: { in: ["locked", "summarized"] },
      },
      select: {
        title: true,
        summary: true,
        status: true,
      },
      orderBy: { index: "asc" },
    });

    const modelAProvider = createLLMProvider({
      apiBaseUrl: modelARecord.provider.apiBaseUrl,
      apiKey: modelARecord.provider.apiKey,
    });
    const modelBProvider = createLLMProvider({
      apiBaseUrl: modelBRecord.provider.apiBaseUrl,
      apiKey: modelBRecord.provider.apiKey,
    });

    const constraints = body.constraints
      ? {
          wordLimit: body.constraints.wordLimit,
          additionalRequirements: body.constraints.additionalRequirements,
        }
      : undefined;

    const result = await compareSection(
      draft,
      section,
      completedSections,
      user.id,
      { provider: modelAProvider, modelId: modelARecord.modelId, modelConfigId: modelARecord.id },
      { provider: modelBProvider, modelId: modelBRecord.modelId, modelConfigId: modelBRecord.id },
      constraints
    );

    await Promise.all([
      recordTokenUsage({
        userId: user.id,
        modelConfigId: modelARecord.id,
        module: "comparison",
        inputTokens: result.inputTokensA,
        outputTokens: result.outputTokensA,
        referenceId: sectionId,
      }).catch((err) => { console.warn("Failed to record token usage:", err); }),
      recordTokenUsage({
        userId: user.id,
        modelConfigId: modelBRecord.id,
        module: "comparison",
        inputTokens: result.inputTokensB,
        outputTokens: result.outputTokensB,
        referenceId: sectionId,
      }).catch((err) => { console.warn("Failed to record token usage:", err); }),
    ]);

    const updatedSection = await db.section.update({
      where: { id: sectionId },
      data: {
        contentA: stripLeadingSectionTitle(result.contentA, section.title),
        contentB: stripLeadingSectionTitle(result.contentB, section.title),
        modelA: result.modelA,
        modelB: result.modelB,
        status: "comparing",
      },
    });

    return successResponse({ section: updatedSection, references });
  } catch (error: unknown) {
    try {
      await db.section.update({
        where: { id: sectionId },
        data: { status: "failed" },
      });
    } catch {
    }

    return errorResponse(error);
  }
}
