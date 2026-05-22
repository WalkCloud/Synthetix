import { db } from "@/lib/db";

interface RagReference {
  documentId?: string;
  chunkId?: string;
  documentName: string;
  title?: string | null;
  content: string;
  score: number;
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
      })),
    });
  }
}
