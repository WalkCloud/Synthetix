import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { resolveModel } from "@/lib/llm/resolve-model";
import { resolveEmbeddingDim } from "@/lib/rag/dimension";
import { manageRag, buildConfig } from "@/lib/rag/client";
import type { ApiResponse } from "@/types/api";

const storage = new LocalStorageAdapter();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: { ...doc, tags: doc.tags.map((dt) => dt.tag) },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  await storage.deleteDocument(id, user.id);
  await db.document.delete({ where: { id } });

  // Clean up LightRAG index (best-effort, non-blocking)
  deleteLightRagData(id, user.id).catch((err) => { console.warn("LightRAG cleanup failed:", err); });

  return NextResponse.json({ success: true, data: { deleted: id } });
}

async function deleteLightRagData(docId: string, userId: string) {
  const [embedModel, llmModel] = await Promise.all([
    resolveModel("embedding"),
    resolveModel("writing"),
  ]);
  if (!embedModel || !llmModel?.provider.apiKey) return;
  const embedDim = await resolveEmbeddingDim(embedModel).catch(() => 0);
  await manageRag({
    userId,
    action: "delete-by-doc",
    embedConfig: buildConfig(embedModel),
    llmConfig: buildConfig(llmModel),
    embedDim,
    docId,
  });
}
