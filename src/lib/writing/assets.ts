import { db } from "@/lib/db";
import { parseDiagramRequests } from "@/lib/writing/diagram";

export async function persistDiagramAssets(
  draftId: string,
  sectionId: string,
  content: string
): Promise<{ assets: number; cleaned: string }> {
  const { diagrams, images, cleaned } = parseDiagramRequests(content);

  if (diagrams.length === 0 && images.length === 0) {
    return { assets: 0, cleaned };
  }

  await db.sectionAsset.deleteMany({ where: { sectionId } });

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

  for (const image of images) {
    if (!image.prompt) continue;
    await db.sectionAsset.create({
      data: {
        draftId,
        sectionId,
        type: "image",
        title: image.title,
        description: image.prompt.slice(0, 200),
        prompt: image.raw,
        status: "pending",
        metadata: JSON.stringify({
          imagePrompt: image.prompt,
        }),
      },
    });
  }

  return { assets: diagrams.length + images.length, cleaned };
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
  let result = content.replace(
    /\[DIAGRAM_REQUEST:[\s\S]*?\]/g,
    (match) => {
      const parsed = parseDiagramRequests(match);
      if (parsed.diagrams.length === 0) return match;
      const d = parsed.diagrams[0];
      return `[Image placeholder - ${d.title}: chart pending]`;
    }
  );

  result = result.replace(
    /\[IMAGE_REQUEST:[\s\S]*?\]/g,
    (match) => {
      const parsed = parseDiagramRequests(match);
      if (parsed.images.length === 0) return match;
      const img = parsed.images[0];
      return `[Image placeholder - ${img.title}: image pending]`;
    }
  );

  return result;
}
