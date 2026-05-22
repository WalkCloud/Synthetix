import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { compareSection } from "@/lib/writing/generator";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { persistSectionReferences } from "@/lib/writing/persist-references";
import { resolveModelOrFallback, resolveSecondModel } from "@/lib/writing/resolve-models";
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

    const modelARecord = await resolveModelOrFallback(body.modelAConfigId, "writing");
    const modelBRecord = await resolveSecondModel(modelARecord.id);

    await db.section.update({
      where: { id: sectionId },
      data: { status: "retrieving" },
    });

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

    await persistSectionReferences(sectionId, result.ragReferences);

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

    return successResponse({ section: updatedSection, references: result.ragReferences });
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
