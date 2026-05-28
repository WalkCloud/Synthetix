import { db } from "@/lib/db";
import { parseDiagramRequests } from "@/lib/writing/diagram";
import { injectMarkerIds } from "@/lib/writing/marker-parser";

import type { DiagramRequest, ImageRequest } from "./diagram";

interface ParsedAssetRequest {
  type: "diagram" | "image";
  title: string;
  purpose?: string;
  raw: string;
  prompt?: string;
  diagramType?: string;
  placement?: string;
  nodes?: unknown;
  flows?: unknown;
  markerId?: string;
}

function normalizeDiagrams(diagrams: DiagramRequest[]): ParsedAssetRequest[] {
  return diagrams.map((d) => ({ type: "diagram" as const, title: d.title, purpose: d.purpose, raw: d.raw, diagramType: d.type, placement: d.placement, nodes: d.nodes, flows: d.flows }));
}

function normalizeImages(images: ImageRequest[]): ParsedAssetRequest[] {
  return images.map((i) => ({ type: "image" as const, title: i.title, raw: i.raw, prompt: i.prompt }));
}

export async function createAssetRequests(
  draftId: string,
  sectionId: string,
  rawContent: string,
): Promise<{ diagrams: ParsedAssetRequest[]; images: ParsedAssetRequest[]; contentWithIds: string }> {
  const contentWithIds = injectMarkerIds(rawContent);
  const { diagrams, images } = parseDiagramRequests(contentWithIds);
  if (diagrams.length === 0 && images.length === 0) {
    return { diagrams: normalizeDiagrams(diagrams), images: normalizeImages(images), contentWithIds };
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
        metadata: JSON.stringify({ imagePrompt: image.prompt }),
      },
    });
  }

  return { diagrams: normalizeDiagrams(diagrams), images: normalizeImages(images), contentWithIds };
}
