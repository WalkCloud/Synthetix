import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { generateSummary } from "@/lib/writing/summarizer";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

async function generateSummaryBackground(sectionId: string, content: string, title: string, userId: string) {
  try {
    const summary = await generateSummary(content, title, userId, sectionId);
    await db.section.update({
      where: { id: sectionId },
      data: { summary, status: "locked" },
    });
  } catch (err) {
    console.error(`Summary generation failed for section ${sectionId}:`, err);
    await db.section.update({
      where: { id: sectionId },
      data: { status: "locked" },
    });
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { id: true },
    });
    if (!draft) {
      return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, draftId },
      include: { versions: true },
    });
    if (!section) {
      return errorResponse({ code: "sectionNotFound", message: "Section not found" }, 404);
    }

    const hasComparisonCandidates = Boolean(section.contentA || section.contentB);
    const hasSelectedComparison = Boolean(section.selectedModel && section.content);

    if (hasComparisonCandidates && !hasSelectedComparison) {
      return errorResponse(
        "Please select a source (A or B) before confirming",
        400
      );
    }

    if (!section.content) {
      return errorResponse({ code: "invalidInput", message: "Section has no content to confirm" }, 400);
    }

    const wordCount = section.content.split(/\s+/).filter(Boolean).length;
    const nextVersion = section.versions.length + 1;

    const versionSource = section.selectedModel
      ? section.selectedModel === section.modelA
        ? "generated_a"
        : section.selectedModel === section.modelB
          ? "generated_b"
          : "edited"
      : "edited";

    await db.sectionVersion.create({
      data: {
        sectionId,
        version: nextVersion,
        content: section.content,
        source: versionSource,
        wordCount,
      },
    });

    const locked = await db.section.update({
      where: { id: sectionId },
      data: { status: "locked", wordCount },
    });

    generateSummaryBackground(sectionId, section.content, section.title, user.id);

    return successResponse(locked);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
