import { db } from "@/lib/db";

type WritingReference =
  | {
      sourceType?: "rag_chunk";
      documentId?: string;
      chunkId?: string;
      documentName: string;
      title?: string | null;
      content: string;
      score: number;
      images?: Array<{ id: string; documentId: string; filename: string; url: string; altText: string | null; mimeType: string; fileSize: number; width: number | null; height: number | null; pageNumber: number | null }>;
    }
  | {
      sourceType: "rag_graph";
      documentId?: string;
      chunkId?: string;
      documentName: string;
      title?: string | null;
      content: string;
      score: number;
      images?: Array<{ id: string; documentId: string; filename: string; url: string; altText: string | null; mimeType: string; fileSize: number; width: number | null; height: number | null; pageNumber: number | null }>;
    };

// Backward-compatible alias for callers that pass plain rag references
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
  references: WritingReference[],
) {
  await db.$transaction(async (tx) => {
    await tx.sectionReference.deleteMany({ where: { sectionId } });
    if (references.length > 0) {
      await tx.sectionReference.createMany({
        data: references.map((ref) => {
          if ("sourceType" in ref && ref.sourceType === "rag_graph") {
            const rag = ref as unknown as RagReference;
            return {
              sectionId,
              documentId: rag.documentId || null,
              chunkId: rag.chunkId || null,
              documentName: rag.documentName,
              relevanceScore: rag.score,
              sourceAnchor: rag.title || null,
              content: rag.content || null,
              images: rag.images ? JSON.stringify(rag.images) : null,
              sourceType: "rag_graph" as const,
            };
          }
          // rag_chunk (default) — backward compatible with callers that don't set sourceType
          const rag = ref as unknown as RagReference;
          return {
            sectionId,
            documentId: rag.documentId || null,
            chunkId: rag.chunkId || null,
            documentName: rag.documentName,
            relevanceScore: rag.score,
            sourceAnchor: rag.title || null,
            content: rag.content || null,
            images: rag.images ? JSON.stringify(rag.images) : null,
            sourceType: "rag_chunk" as const,
          };
        }),
      });
    }
  });
}
