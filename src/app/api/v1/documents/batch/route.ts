import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

const storage = new LocalStorageAdapter();

export async function DELETE(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { ids }: { ids: string[] } = await request.json();
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return errorResponse("ids required", 400);
  }

  const docs = await db.document.findMany({
    where: { id: { in: ids }, userId: user.id },
    select: { id: true },
  });
  const ownIds = docs.map((d) => d.id);

  for (const id of ownIds) {
    await storage.deleteDocumentData(id, user.id);
    await db.documentChunk.deleteMany({ where: { documentId: id } }).catch(() => {});
    await db.documentTag.deleteMany({ where: { documentId: id } }).catch(() => {});
    await db.documentImage.deleteMany({ where: { documentId: id } }).catch(() => {});
    await db.document.delete({ where: { id } });
    deleteLightRagData(id, user.id).catch((err) => {
      console.warn("LightRAG cleanup failed:", err);
    });
  }

  return successResponse({ deleted: ownIds.length });
}

async function deleteLightRagData(docId: string, userId: string) {
  const ctx = await createRagContext(userId, { requireLlm: true }).catch(() => null);
  if (!ctx?.llmConfig) return;
  await manageRag({
    userId,
    action: "delete-by-doc",
    embedConfig: ctx.embedConfig,
    llmConfig: ctx.llmConfig,
    rerankConfig: ctx.rerankConfig,
    embedDim: ctx.embedDim,
    docId,
  });
}
