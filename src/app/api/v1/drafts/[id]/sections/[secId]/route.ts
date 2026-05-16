import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { parseDiagramRequests } from "@/lib/writing/diagram";
import type { ApiResponse } from "@/types/api";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

interface UpdateSectionBody {
  content?: string;
  selectedSource?: "a" | "b";
  constraints?: string;
  ragMode?: "auto" | "manual" | "off";
  ragDocumentIds?: string[];
}

export async function GET(
  _request: Request,
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

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { id: true },
    });
    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 }
      );
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, draftId },
      include: { versions: { orderBy: { version: "desc" } } },
    });
    if (!section) {
      return NextResponse.json(
        { success: false, error: "Section not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: section });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
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

  let body: UpdateSectionBody;
  try {
    body = (await request.json()) as UpdateSectionBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { id: true },
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

    const updateData: Record<string, unknown> = {};

    // Handle source selection from comparison
    if (body.selectedSource === "a" || body.selectedSource === "b") {
      const sourceContent =
        body.selectedSource === "a" ? section.contentA : section.contentB;
      if (!sourceContent) {
        return NextResponse.json(
          {
            success: false,
            error: `Content ${body.selectedSource.toUpperCase()} is not available for selection`,
          },
          { status: 400 }
        );
      }
      updateData.content = sourceContent;
      updateData.selectedModel =
        body.selectedSource === "a" ? section.modelA : section.modelB;
      updateData.wordCount = sourceContent.split(/\s+/).filter(Boolean).length;
      updateData.status = "reviewing";
    } else if (body.content !== undefined) {
      const { cleaned, diagrams, images } = parseDiagramRequests(body.content);
      updateData.content = cleaned;
      updateData.wordCount = cleaned.split(/\s+/).filter(Boolean).length;
      if (diagrams.length > 0 || images.length > 0) {
        console.warn(`PUT section ${sectionId}: ${diagrams.length} DIAGRAM_REQUEST + ${images.length} IMAGE_REQUEST blocks found in edited content — stripped but not persisted as assets. Re-generate the section to create assets.`);
      }
    }

    if (body.constraints !== undefined) {
      updateData.constraints = body.constraints;
    }

    if (body.ragMode !== undefined) {
      updateData.ragMode = body.ragMode;
    }

    if (body.ragDocumentIds !== undefined) {
      updateData.ragDocumentIds = JSON.stringify(body.ragDocumentIds);
    }

    const updatedSection = await db.section.update({
      where: { id: sectionId },
      data: updateData,
    });

    return NextResponse.json({ success: true, data: updatedSection });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
