import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { compareSection } from "@/lib/writing/generator";
import { semanticSearch } from "@/lib/search/semantic";
import type { ApiResponse } from "@/types/api";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id: draftId, secId: sectionId } = await params;

  let body: { constraints?: { wordLimit?: number; additionalRequirements?: string } };
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
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 }
      );
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, draftId },
    });
    if (!section) {
      return NextResponse.json(
        { success: false, error: "Section not found" },
        { status: 404 }
      );
    }

    // Resolve two models for comparison
    const modelARecord = await db.modelConfig.findFirst({
      where: { isDefaultFor: "writing" },
      include: { provider: true },
    });
    if (!modelARecord?.provider) {
      return NextResponse.json(
        { success: false, error: "No default writing model configured. Set a default writing model in settings." },
        { status: 400 }
      );
    }

    // Find a second model different from model A
    const modelBRecord = await db.modelConfig.findFirst({
      where: {
        id: { not: modelARecord.id },
        capabilities: { contains: "chat" },
      },
      include: { provider: true },
    });
    if (!modelBRecord?.provider) {
      return NextResponse.json(
        { success: false, error: "No second model available for comparison. Add another chat-capable model in settings." },
        { status: 400 }
      );
    }

    // Update status to "retrieving"
    await db.section.update({
      where: { id: sectionId },
      data: { status: "retrieving" },
    });

    // RAG search
    const searchQuery = [section.title, section.description].filter(Boolean).join(" ");
    const references = await semanticSearch(searchQuery, user.id, 5);

    // Persist references for topology
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

    // Update status to "comparing"
    await db.section.update({
      where: { id: sectionId },
      data: { status: "comparing" },
    });

    // Get completed sections for context
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

    // Run comparison generation
    const result = await compareSection(
      draft,
      section,
      completedSections,
      user.id,
      { provider: modelAProvider, modelId: modelARecord.modelId, modelConfigId: modelARecord.id },
      { provider: modelBProvider, modelId: modelBRecord.modelId, modelConfigId: modelBRecord.id },
      constraints
    );

    // Record token usage for both models
    await Promise.all([
      recordTokenUsage({
        userId: user.id,
        modelConfigId: modelARecord.id,
        module: "comparison",
        inputTokens: result.inputTokensA,
        outputTokens: result.outputTokensA,
        referenceId: sectionId,
      }).catch(() => {}),
      recordTokenUsage({
        userId: user.id,
        modelConfigId: modelBRecord.id,
        module: "comparison",
        inputTokens: result.inputTokensB,
        outputTokens: result.outputTokensB,
        referenceId: sectionId,
      }).catch(() => {}),
    ]);

    // Update section with comparison results
    const updatedSection = await db.section.update({
      where: { id: sectionId },
      data: {
        contentA: result.contentA,
        contentB: result.contentB,
        modelA: result.modelA,
        modelB: result.modelB,
        status: "comparing",
      },
    });

    return NextResponse.json({
      success: true,
      data: { section: updatedSection, references },
    });
  } catch (error: unknown) {
    // Set section to "failed" on error
    try {
      await db.section.update({
        where: { id: sectionId },
        data: { status: "failed" },
      });
    } catch {
      // Best-effort status update; don't mask original error
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
