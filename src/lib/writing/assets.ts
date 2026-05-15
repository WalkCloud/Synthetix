import { db } from "@/lib/db";
import { parseDiagramRequests, type DiagramRequest } from "@/lib/writing/diagram";

export async function persistDiagramAssets(
  draftId: string,
  sectionId: string,
  content: string
): Promise<{ assets: number; cleaned: string }> {
  const { diagrams, cleaned } = parseDiagramRequests(content);

  if (diagrams.length === 0) {
    return { assets: 0, cleaned };
  }

  for (const diagram of diagrams) {
    await db.sectionAsset.create({
      data: {
        draftId,
        sectionId,
        type: "diagram",
        title: diagram.title,
        description: diagram.purpose,
        prompt: diagram.raw,
        status: "pending",
        metadata: JSON.stringify({
          diagramType: diagram.type,
          placement: diagram.placement,
          nodes: diagram.nodes,
          flows: diagram.flows,
        }),
      },
    });
  }

  return { assets: diagrams.length, cleaned };
}

export async function getSectionAssets(draftId: string, sectionId: string) {
  return db.sectionAsset.findMany({
    where: { draftId, sectionId },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteSectionAssets(draftId: string, sectionId: string) {
  return db.sectionAsset.deleteMany({
    where: { draftId, sectionId },
  });
}

export function replaceDiagramBlocksWithPlaceholders(content: string): string {
  return content.replace(
    /\[DIAGRAM_REQUEST:[\s\S]*?\]/g,
    (match) => {
      const parsed = parseDiagramRequests(match);
      if (parsed.diagrams.length === 0) return match;
      const d = parsed.diagrams[0];
      return `[图片占位符 — ${d.title}：图表待生成]`;
    }
  );
}
