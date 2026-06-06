import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

const storage = new LocalStorageAdapter();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, userId: user.id },
    include: {
      chunks: { orderBy: { index: "asc" } },
      tags: { include: { tag: true } },
      children: true,
    },
  });

  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  return successResponse({ ...doc, tags: doc.tags.map((dt) => dt.tag) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  await storage.deleteDocumentData(id, user.id);
  await db.documentChunk.deleteMany({ where: { documentId: id } }).catch(() => {});
  await db.documentTag.deleteMany({ where: { documentId: id } }).catch(() => {});
  await db.documentImage.deleteMany({ where: { documentId: id } }).catch(() => {});
  await db.document.delete({ where: { id } });

  deleteLightRagData(id, user.id).catch((err) => { console.warn("LightRAG cleanup failed:", err); });

  return successResponse({ deleted: id });
}

async function deleteLightRagData(docId: string, userId: string) {
  const ctx = await createRagContext(userId).catch((err) => {
    console.error(`Failed to resolve RAG context for doc ${docId} deletion:`, err);
    return null;
  });
  if (!ctx?.embedConfig) {
    console.warn(`Cannot clean LightRAG for doc ${docId} — no embedding config available`);
    return;
  }
  const result = await manageRag({
    userId,
    action: "delete-by-doc",
    embedConfig: ctx.embedConfig,
    llmConfig: ctx.llmConfig || { apiBase: "", apiKey: "", model: "" },
    rerankConfig: ctx.rerankConfig,
    embedDim: ctx.embedDim,
    docId,
  }).catch((err) => { console.error(`LightRAG cleanup error for doc ${docId}:`, err); return null; });
  if (result) console.log(`LightRAG cleanup completed for doc ${docId}`, result);
}
