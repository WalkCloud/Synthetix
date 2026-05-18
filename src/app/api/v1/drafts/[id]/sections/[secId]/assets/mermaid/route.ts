import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import path from "node:path";
import fs from "node:fs/promises";
import { buildSpecFromStructuredJson, buildSpecFromRawPrompt } from "@/lib/writing/diagram-spec";
import { renderDiagramSvg } from "@/lib/writing/diagram-renderer";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "sections");

function parseJsonInput(code: string): { nodes: any[]; edges: any[] } | null {
  try {
    const json = JSON.parse(code);
    if (json.nodes && Array.isArray(json.nodes)) {
      return { nodes: json.nodes, edges: json.arrows || [] };
    }
  } catch {}
  return null;
}

function parseMermaidBasic(code: string): { nodes: any[]; edges: any[] } {
  const nodes: { id: string; label: string }[] = [];
  const edges: { from: string; to: string; label?: string }[] = [];
  const nodeMap = new Map<string, { id: string; label: string }>();

  const ensureNode = (id: string, label?: string) => {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, label: label || id });
    }
    return nodeMap.get(id)!;
  };

  const edgeRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:-\.-?>|--?>|==>)\s*(?:\|([^|]+)\|\s*)?([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = edgeRegex.exec(code)) !== null) {
    const fromId = match[1];
    const toId = match[3];
    const edgeLabel = match[2];
    ensureNode(fromId);
    ensureNode(toId);
    edges.push({ from: fromId, to: toId, label: edgeLabel });
  }

  const nodeRegex = /([A-Za-z_][A-Za-z0-9_]*)\[(?:([^\]]+))\]/g;
  while ((match = nodeRegex.exec(code)) !== null) {
    const id = match[1];
    const label = match[2];
    ensureNode(id, label);
  }

  return { nodes: [...nodeMap.values()], edges };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;
  const body = await request.json();
  const { code, title, replaceAssetId } = body as {
    code?: string;
    title?: string;
    replaceAssetId?: string;
  };

  if (!code || !code.trim()) {
    return errorResponse("Diagram code is required", 400);
  }

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return errorResponse("Draft not found", 404);
  }

  try {
    let svg: string;
    const trimmedCode = code.trim();
    console.log("[mermaid] received code (first 500 chars):", trimmedCode.slice(0, 500));

    const jsonInput = parseJsonInput(trimmedCode);
    console.log("[mermaid] jsonInput parsed:", !!jsonInput, jsonInput ? `nodes=${jsonInput.nodes.length}` : "null");

    if (jsonInput) {
      const spec = buildSpecFromStructuredJson(JSON.parse(trimmedCode));
      if (spec.nodes.length === 0) {
        return errorResponse("No nodes found in diagram JSON", 400);
      }
      svg = renderDiagramSvg(spec);
    } else {
      const { nodes, edges } = parseMermaidBasic(trimmedCode);
      console.log("[mermaid] mermaidBasic parsed:", nodes.length, "nodes,", edges.length, "edges");
      if (nodes.length === 0) {
        return errorResponse("Could not parse any nodes from code", 400);
      }
      const spec = buildSpecFromRawPrompt(
        [
          `type=architecture`,
          `title=${title || "Diagram"}`,
          `style=flat-icon`,
          `nodes=${nodes.map((n) => n.label).join(",")}`,
          `flows=${edges.map((e) => `${e.from}->${e.to}${e.label ? `(${e.label})` : ""}`).join(",")}`,
        ].join("\n")
      );
      svg = renderDiagramSvg(spec);
    }

    const sectionDir = path.join(ASSETS_DIR, sectionId);
    await fs.mkdir(sectionDir, { recursive: true });

    const sanitizedTitle = (title || "diagram")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
    const filename = `diagram-${sanitizedTitle}.svg`;
    const filePath = path.join(sectionDir, filename);
    await fs.writeFile(filePath, svg, "utf-8");
    const relativePath = `assets/sections/${sectionId}/${filename}`;

    let assetId: string;

    if (replaceAssetId) {
      const existing = await db.sectionAsset.findFirst({
        where: { id: replaceAssetId, draftId, sectionId },
      });
      if (!existing) {
        return errorResponse("Target asset not found", 404);
      }
      await db.sectionAsset.update({
        where: { id: replaceAssetId },
        data: {
          type: "mermaid",
          title: title || existing.title,
          path: relativePath,
          mimeType: "image/svg+xml",
          status: "ready",
          prompt: trimmedCode,
          metadata: JSON.stringify({ renderedAt: new Date().toISOString(), format: jsonInput ? "json" : "mermaid" }),
        },
      });
      assetId = replaceAssetId;
    } else {
      const asset = await db.sectionAsset.create({
        data: {
          draftId,
          sectionId,
          type: "mermaid",
          title: title || "Diagram",
          path: relativePath,
          mimeType: "image/svg+xml",
          status: "ready",
          prompt: trimmedCode,
          metadata: JSON.stringify({ format: jsonInput ? "json" : "mermaid" }),
        },
      });
      assetId = asset.id;

      const sectionContent = await db.section.findUnique({
        where: { id: sectionId },
        select: { content: true },
      });
      if (sectionContent?.content) {
        const marker = `[IMAGE:${assetId}]`;
        if (!sectionContent.content.includes(marker)) {
          await db.section.update({
            where: { id: sectionId },
            data: { content: sectionContent.content + "\n\n" + marker },
          });
        }
      }
    }

    return successResponse({ assetId, path: relativePath, status: "ready", mode: replaceAssetId ? "replaced" : "created" });
  } catch (error) {
    console.error("[mermaid] render error:", error);
    return errorResponse(error);
  }
}
