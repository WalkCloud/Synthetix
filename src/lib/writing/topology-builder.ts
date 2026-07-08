import { db } from "@/lib/db";
import { isSectionDone } from "@/lib/writing/status";
import type { TopologyNode, TopologyEdge, TopologyStats } from "@/types/topology";

interface ReferenceGroup {
  documentName: string;
  documentId: string | null;
  refs: { relevanceScore: number; sectionId: string; sectionTitle: string; sourceAnchor?: string | null }[];
  sections: { id: string; title: string }[];
}

function inferFormatFromExtension(documentName: string): string {
  const lowerName = documentName.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "pdf";
  if (lowerName.endsWith(".docx")) return "docx";
  if (lowerName.endsWith(".md")) return "md";
  return "unknown";
}

export async function buildTopology(draftId: string) {
  const draft = await db.draft.findFirst({
    where: { id: draftId },
    select: { id: true, title: true, status: true },
  });
  if (!draft) return null;

  const sections = await db.section.findMany({
    where: { draftId },
    include: { references: true },
    orderBy: { index: "asc" },
  });

  const groupMap = new Map<string, ReferenceGroup>();
  for (const section of sections) {
    for (const ref of section.references) {
      // Only real uploaded-document chunks belong in the topology.
      // Exclude synthetic retrieval sources: "wiki" (LLM-distilled entries,
      // documentName hardcoded to "Knowledge Base") and "rag_graph" (entity
      // names from the knowledge graph). They are not files the user uploaded
      // and only confuse the "which documents did I reference?" mental model.
      if (ref.sourceType !== "rag_chunk") continue;
      const groupKey = ref.documentName || `id:${ref.documentId || "unknown"}`;
      const existing = groupMap.get(groupKey);
      if (existing) {
        existing.refs.push({ relevanceScore: ref.relevanceScore, sectionId: section.id, sectionTitle: section.title, sourceAnchor: ref.sourceAnchor });
        if (!existing.sections.some((s) => s.id === section.id)) {
          existing.sections.push({ id: section.id, title: section.title });
        }
      } else {
        groupMap.set(groupKey, {
          documentName: ref.documentName,
          documentId: ref.documentId,
          refs: [{ relevanceScore: ref.relevanceScore, sectionId: section.id, sectionTitle: section.title, sourceAnchor: ref.sourceAnchor }],
          sections: [{ id: section.id, title: section.title }],
        });
      }
    }
  }

  const referenceNodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  const totalReferences = sections.reduce((sum, s) => sum + s.references.length, 0);
  const uniqueDocuments = groupMap.size;
  const sectionsWithReferences = sections.filter((s) => s.references.length > 0).length;
  const totalSections = sections.length;
  const completedSections = sections.filter((s) => isSectionDone(s.status)).length;

  let mostReferencedDoc: string | null = null;
  let maxRefCount = 0;
  for (const [, group] of groupMap) {
    if (group.refs.length > maxRefCount) { maxRefCount = group.refs.length; mostReferencedDoc = group.documentName; }
  }

  const draftNode: TopologyNode = {
    id: draftId, type: "draft", label: draft.title,
    format: "draft", referenceCount: totalReferences, relevanceScore: 0,
    draftStatus: draft.status, totalSections, completedSections,
    sectionsWithReferences, totalReferences, uniqueDocuments, mostReferencedDoc,
  };

  for (const [groupKey, group] of groupMap) {
    const totalRefs = group.refs.length;
    const avgScore = totalRefs > 0 ? group.refs.reduce((sum, r) => sum + r.relevanceScore, 0) / totalRefs : 0;
    referenceNodes.push({
      id: groupKey, type: "reference", label: group.documentName,
      format: inferFormatFromExtension(group.documentName),
      referenceCount: totalRefs, relevanceScore: Math.round(avgScore * 1000) / 1000,
      referenceChunks: group.refs.map((r) => ({
        sourceAnchor: r.sourceAnchor,
        sectionTitle: r.sectionTitle,
        relevanceScore: r.relevanceScore,
      })),
    });
    edges.push({
      source: draftId, target: groupKey, weight: totalRefs,
      sectionIds: group.sections.map((s) => s.id),
      sectionLabels: group.sections.map((s) => s.title),
    });
  }

  const nodes = [draftNode, ...referenceNodes];

  const stats: TopologyStats = {
    totalReferences, uniqueDocuments, sectionsWithReferences, totalSections,
    mostReferencedDoc, coverage: `${sectionsWithReferences}/${totalSections} sections have references`,
  };

  return { draft: { id: draft.id, title: draft.title, status: draft.status }, nodes, edges, stats };
}
