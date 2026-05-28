import { db } from "@/lib/db";

interface RagReference {
  documentId?: string;
  chunkId?: string;
  documentName: string;
  title?: string | null;
  content: string;
  score: number;
  images?: Array<{ id: string; documentId: string; filename: string; url: string; altText: string | null; mimeType: string; fileSize: number; width: number | null; height: number | null; pageNumber: number | null }>;
}

export async function persistSectionReferences(
  sectionId: string,
  references: RagReference[],
) {
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
        content: ref.content || null,
        images: ref.images ? JSON.stringify(ref.images) : null,
      })),
    });
  }
}
