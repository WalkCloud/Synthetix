import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";
import type {
  TopologyResponse,
  TopologyNode,
  TopologyEdge,
  TopologyStats,
} from "@/types/topology";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

interface ReferenceGroup {
  documentName: string;
  documentId: string | null;
  refs: { relevanceScore: number }[];
  sections: { id: string; title: string }[];
}

function inferFormatFromExtension(documentName: string): string {
  const lowerName = documentName.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "pdf";
  if (lowerName.endsWith(".docx")) return "docx";
  if (lowerName.endsWith(".md")) return "md";
  return "unknown";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse<TopologyResponse>>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id: draftId } = await params;

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { id: true, title: true, status: true },
    });

    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 }
      );
    }

    const sections = await db.section.findMany({
      where: { draftId },
      include: { references: true },
      orderBy: { index: "asc" },
    });

    // Group references by document
    const groupMap = new Map<string, ReferenceGroup>();

    for (const section of sections) {
      for (const ref of section.references) {
        const groupKey =
          ref.documentId && ref.documentId.trim() !== ""
            ? ref.documentId
            : `name:${ref.documentName}`;

        const existing = groupMap.get(groupKey);
        if (existing) {
          existing.refs = [...existing.refs, { relevanceScore: ref.relevanceScore }];
          const sectionAlreadyTracked = existing.sections.some(
            (s) => s.id === section.id
          );
          if (!sectionAlreadyTracked) {
            existing.sections = [
              ...existing.sections,
              { id: section.id, title: section.title },
            ];
          }
        } else {
          groupMap.set(groupKey, {
            documentName: ref.documentName,
            documentId: ref.documentId,
            refs: [{ relevanceScore: ref.relevanceScore }],
            sections: [{ id: section.id, title: section.title }],
          });
        }
      }
    }

    // Build nodes
    const draftNode: TopologyNode = {
      id: draftId,
      type: "draft",
      label: draft.title,
      format: "draft",
      referenceCount: 0,
      relevanceScore: 0,
    };

    const referenceNodes: TopologyNode[] = [];
    const edges: TopologyEdge[] = [];

    for (const [groupKey, group] of groupMap) {
      const totalRefs = group.refs.length;
      const avgScore =
        totalRefs > 0
          ? group.refs.reduce((sum, r) => sum + r.relevanceScore, 0) /
            totalRefs
          : 0;

      referenceNodes.push({
        id: groupKey,
        type: "reference",
        label: group.documentName,
        format: inferFormatFromExtension(group.documentName),
        referenceCount: totalRefs,
        relevanceScore: Math.round(avgScore * 1000) / 1000,
      });

      edges.push({
        source: draftId,
        target: groupKey,
        weight: totalRefs,
        sectionIds: group.sections.map((s) => s.id),
        sectionLabels: group.sections.map((s) => s.title),
      });
    }

    const nodes = [draftNode, ...referenceNodes];

    // Build stats
    const totalReferences = sections.reduce(
      (sum, section) => sum + section.references.length,
      0
    );
    const uniqueDocuments = groupMap.size;
    const sectionsWithReferences = sections.filter(
      (section) => section.references.length > 0
    ).length;
    const totalSections = sections.length;

    let mostReferencedDoc: string | null = null;
    let maxRefCount = 0;
    for (const [, group] of groupMap) {
      if (group.refs.length > maxRefCount) {
        maxRefCount = group.refs.length;
        mostReferencedDoc = group.documentName;
      }
    }

    const stats: TopologyStats = {
      totalReferences,
      uniqueDocuments,
      sectionsWithReferences,
      totalSections,
      mostReferencedDoc,
      coverage: `${sectionsWithReferences}/${totalSections} sections have references`,
    };

    return NextResponse.json({
      success: true,
      data: {
        draft: { id: draft.id, title: draft.title, status: draft.status },
        nodes,
        edges,
        stats,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
