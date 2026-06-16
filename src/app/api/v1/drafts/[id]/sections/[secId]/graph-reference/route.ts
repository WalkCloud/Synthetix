import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

interface GraphReferenceBody {
  entityName?: string;
  relationType?: string;
  content?: string;
  documentChunks?: Array<{
    chunkId?: string | null;
    documentId?: string | null;
    documentName?: string | null;
    title?: string | null;
    content?: string | null;
    score?: number | null;
  }>;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;
  const body = (await request.json().catch(() => ({}))) as GraphReferenceBody;
  const entityName = body.entityName?.trim();
  if (!entityName) return errorResponse({ code: "invalidInput", message: "Entity name is required" }, 400);

  const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id }, select: { id: true } });
  if (!draft) return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);

  const section = await db.section.findFirst({ where: { id: sectionId, draftId }, select: { id: true } });
  if (!section) return errorResponse({ code: "sectionNotFound", message: "Section not found" }, 404);

  const chunks = body.documentChunks || [];
  const created = await db.sectionReference.createMany({
    data: chunks.length > 0 ? chunks.map((chunk) => ({
      sectionId,
      documentId: chunk.documentId || null,
      chunkId: chunk.chunkId || null,
      documentName: chunk.documentName || entityName,
      relevanceScore: typeof chunk.score === "number" ? chunk.score : 0.7,
      sourceAnchor: chunk.title || body.relationType || entityName,
      content: chunk.content || body.content || null,
      images: null,
      sourceType: "rag_graph",
    })) : [{
      sectionId,
      documentId: null,
      chunkId: null,
      documentName: entityName,
      relevanceScore: 0.7,
      sourceAnchor: body.relationType || entityName,
      content: body.content || null,
      images: null,
      sourceType: "rag_graph",
    }],
  });

  return successResponse({ inserted: created.count });
}
