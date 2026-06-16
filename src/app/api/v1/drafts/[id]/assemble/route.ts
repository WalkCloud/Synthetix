import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId } = await params;

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
    });
    if (!draft) {
      return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
    }

    const sections = await db.section.findMany({
      where: {
        draftId,
        status: { in: ["locked", "summarized"] },
      },
      orderBy: { index: "asc" },
    });

    if (sections.length === 0) {
      return errorResponse({ code: "invalidInput", message: "No confirmed sections available to assemble" }, 400);
    }

    const titleHeader = `# ${draft.title}\n\n`;
    const sectionParts = sections.map(
      (section) =>
        `## ${section.title}\n\n${stripLeadingSectionTitle(section.content ?? "", section.title)}\n\n`
    );
    const markdown = titleHeader + sectionParts.join("");

    return successResponse({ markdown, sectionCount: sections.length });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
