import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { semanticSearch } from "@/lib/search/semantic";
import { generateSection } from "@/lib/writing/generator";
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

    // Step 3: Update status to "retrieving"
    await db.section.update({
      where: { id: sectionId },
      data: { status: "retrieving" },
    });

    // Step 4: RAG search
    const searchQuery = [section.title, section.description].filter(Boolean).join(" ");
    const references = await semanticSearch(searchQuery, user.id, 5);

    // Step 4b: Persist references for topology
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

    // Step 5: Update status to "generating"
    await db.section.update({
      where: { id: sectionId },
      data: { status: "generating" },
    });

    // Step 6: Get completed sections for context
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

    // Step 7: Generate content
    const constraints = body.constraints
      ? {
          wordLimit: body.constraints.wordLimit,
          additionalRequirements: body.constraints.additionalRequirements,
        }
      : undefined;

    const result = await generateSection(
      draft,
      section,
      completedSections,
      user.id,
      constraints
    );

    // Step 8: Update section with generated content
    const updatedSection = await db.section.update({
      where: { id: sectionId },
      data: {
        content: result.content,
        wordCount: result.content.split(/\s+/).filter(Boolean).length,
        status: "reviewing",
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
