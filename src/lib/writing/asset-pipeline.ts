import { db } from "@/lib/db";
import { parseDiagramRequests } from "@/lib/writing/diagram";
import { ensureRequiredDiagramRequest } from "@/lib/writing/diagram-requirements";
import { injectMarkerIds } from "@/lib/writing/marker-parser";
import type { ContextInput } from "@/lib/writing/context";

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
  relationships?: unknown;
  groups?: unknown;
  boundaries?: unknown;
  markerId?: string;
}

function normalizeDiagrams(diagrams: DiagramRequest[]): ParsedAssetRequest[] {
  return diagrams.map((d) => ({
    type: "diagram" as const,
    title: d.title,
    purpose: d.purpose,
    raw: d.raw,
    diagramType: d.type,
    placement: d.placement,
    nodes: d.nodes,
    flows: d.flows,
    relationships: d.relationships,
    groups: d.groups,
    boundaries: d.boundaries,
  }));
}

function normalizeImages(images: ImageRequest[]): ParsedAssetRequest[] {
  return images.map((i) => ({ type: "image" as const, title: i.title, raw: i.raw, prompt: i.prompt }));
}

export async function createAssetRequests(
  draftId: string,
  sectionId: string,
  rawContent: string,
  section?: ContextInput["section"],
  constraints?: ContextInput["constraints"],
): Promise<{ diagrams: ParsedAssetRequest[]; images: ParsedAssetRequest[]; contentWithIds: string }> {
  const contentToParse = section ? ensureRequiredDiagramRequest(rawContent, section, constraints) : rawContent;
  const contentWithIds = injectMarkerIds(contentToParse);
  const { diagrams, images } = parseDiagramRequests(contentWithIds);
  if (diagrams.length === 0 && images.length === 0) {
    return { diagrams: normalizeDiagrams(diagrams), images: normalizeImages(images), contentWithIds };
  }

  await db.sectionAsset.deleteMany({ where: { sectionId } });

  const allAssets = [
    ...diagrams.map((d) => ({
      draftId,
      sectionId,
      type: "diagram" as const,
      title: d.title,
      description: d.purpose,
      prompt: d.raw,
      status: "pending" as const,
      metadata: JSON.stringify({
        diagramType: d.type,
        placement: d.placement,
        nodes: d.nodes,
        flows: d.flows,
        relationships: d.relationships,
        groups: d.groups,
        boundaries: d.boundaries,
      }),
    })),
    ...images.filter((i) => i.prompt).map((i) => ({
      draftId,
      sectionId,
      type: "image" as const,
      title: i.title,
      description: i.prompt!.slice(0, 200),
      prompt: i.raw,
      status: "pending" as const,
      metadata: JSON.stringify({ imagePrompt: i.prompt }),
    })),
  ];

  if (allAssets.length > 0) {
    await db.sectionAsset.createMany({ data: allAssets });
  }

  return { diagrams: normalizeDiagrams(diagrams), images: normalizeImages(images), contentWithIds };
}
