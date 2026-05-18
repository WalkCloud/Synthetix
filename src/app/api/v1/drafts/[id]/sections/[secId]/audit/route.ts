import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { auditSection } from "@/lib/writing/auditor";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
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

  if (!section.content) {
    return errorResponse("Section has no content to audit", 400);
  }

  const result = await auditSection(section.title, section.content, section.keyPoints);

  await db.section.update({
    where: { id: sectionId },
    data: {
      constraints: JSON.stringify({
        ...(section.constraints ? JSON.parse(section.constraints) : {}),
        _audit: result,
      }),
    },
  });

  return successResponse(result);
}
