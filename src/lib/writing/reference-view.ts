export interface PersistedSectionReference {
  documentName: string;
  relevanceScore: number;
  sourceAnchor: string | null;
  documentId: string | null;
  chunkId?: string | null;
  content: string | null;
  images?: string | null | Array<{ documentId: string; filename: string; url: string; altText: string | null }>;
  sourceType?: string | null;
}

export interface RagReferenceView {
  documentName: string;
  content: string;
  score: number;
  title?: string | null;
  sourceInfo?: string;
  sourceType: "rag_chunk" | "rag_graph" | "wiki";
  documentId?: string | null;
  chunkId?: string | null;
  images?: Array<{ documentId: string; filename: string; url: string; altText: string | null }>;
}

function parseImages(value: PersistedSectionReference["images"]): RagReferenceView["images"] {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function splitSectionReferences(refs: PersistedSectionReference[]): RagReferenceView[] {
  return refs.map((ref) => ({
    documentName: ref.documentName,
    content: ref.content || "",
    score: ref.relevanceScore,
    title: ref.sourceAnchor,
    sourceInfo: ref.sourceAnchor || undefined,
    sourceType: (ref.sourceType === "rag_graph" || ref.sourceType === "wiki" ? ref.sourceType : "rag_chunk") as RagReferenceView["sourceType"],
    documentId: ref.documentId,
    chunkId: ref.chunkId,
    images: parseImages(ref.images),
  }));
}
