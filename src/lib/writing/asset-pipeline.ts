import { db } from "@/lib/db";
import { parseDiagramRequests, segmentContent } from "@/lib/writing/diagram";
import { generateAllPendingAssets } from "@/lib/writing/diagram-generator";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";

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
): Promise<{ diagrams: ParsedAssetRequest[]; images: ParsedAssetRequest[] }> {
  const { diagrams, images } = parseDiagramRequests(rawContent);
  if (diagrams.length === 0 && images.length === 0) {
    return { diagrams: normalizeDiagrams(diagrams), images: normalizeImages(images) };
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

  return { diagrams: normalizeDiagrams(diagrams), images: normalizeImages(images) };
}

export async function generateAndPlaceAssetMarkers(
  draftId: string,
  sectionId: string,
  sectionTitle: string,
  rawContent: string,
): Promise<number> {
  const genResult = await generateAllPendingAssets(draftId, sectionId);
  if (genResult.succeeded === 0) return 0;

  const readyAssets = await db.sectionAsset.findMany({
    where: { sectionId, draftId, status: "ready" },
    orderBy: { createdAt: "asc" },
  });

  const segments = segmentContent(rawContent);
  const diagramAssets = readyAssets.filter((a) => a.type === "diagram" || a.type === "svg");
  const imageAssets = readyAssets.filter((a) => a.type === "image");
  let dIdx = 0, iIdx = 0;
  const positionedParts: string[] = [];

  for (const seg of segments) {
    if (seg.kind === "text") {
      positionedParts.push(seg.content);
    } else if (seg.kind === "diagram" && dIdx < diagramAssets.length) {
      positionedParts.push(`\n\n[DIAGRAM:${diagramAssets[dIdx++].id}]\n\n`);
    } else if (seg.kind === "image" && iIdx < imageAssets.length) {
      positionedParts.push(`\n\n[IMAGE:${imageAssets[iIdx++].id}]\n\n`);
    }
  }

  const markedContent = stripLeadingSectionTitle(positionedParts.join(""), sectionTitle);

  await db.section.update({
    where: { id: sectionId },
    data: { content: markedContent },
  });

  return readyAssets.length;
}
