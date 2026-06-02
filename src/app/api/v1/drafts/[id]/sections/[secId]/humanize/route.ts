import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { humanizeContent } from "@/lib/writing/humanizer";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
  getErrorMessage,
} from "@/lib/api-helpers";

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
      return errorResponse("Draft not found", 404);
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, draftId },
    });
    if (!section) {
      return errorResponse("Section not found", 404);
    }

    const hasContent = section.content?.trim();
    const hasComparison = section.contentA?.trim() || section.contentB?.trim();

    if (!hasContent && !hasComparison) {
      return errorResponse("No content to humanize", 400);
    }

    let updatedSection;
    let auditNotes: string;

    if (hasComparison && (section.status === "comparing" || section.status === "reviewing")) {
      const tasks: Promise<{ content: string; contentField: string; notes: string }>[] = [];

      if (section.contentA?.trim()) {
        tasks.push(
          humanizeContent(section.contentA, section.title, user.id)
            .then((r) => ({ content: r.content, contentField: "contentA", notes: r.auditNotes }))
        );
      }
      if (section.contentB?.trim()) {
        tasks.push(
          humanizeContent(section.contentB, section.title, user.id)
            .then((r) => ({ content: r.content, contentField: "contentB", notes: r.auditNotes }))
        );
      }

      const results = await Promise.all(tasks);
      const updateData: Record<string, unknown> = {};
      let lastNotes = "";

      for (const r of results) {
        updateData[r.contentField] = stripLeadingSectionTitle(r.content, section.title);
        lastNotes = r.notes;
      }

      const humanizedContent = (updateData["contentA"] as string) || (updateData["contentB"] as string) || section.content || "";
      updateData["wordCount"] = humanizedContent.split(/\s+/).filter(Boolean).length;

      updatedSection = await db.section.update({
        where: { id: sectionId },
        data: updateData,
      });
      auditNotes = lastNotes;
    } else {
      const result = await humanizeContent(
        section.content!,
        section.title,
        user.id
      );

      const cleanedContent = stripLeadingSectionTitle(result.content, section.title);

      updatedSection = await db.section.update({
        where: { id: sectionId },
        data: {
          content: cleanedContent,
          wordCount: cleanedContent.split(/\s+/).filter(Boolean).length,
        },
      });
      auditNotes = result.auditNotes;
    }

    return successResponse({
      section: updatedSection,
      auditNotes,
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
