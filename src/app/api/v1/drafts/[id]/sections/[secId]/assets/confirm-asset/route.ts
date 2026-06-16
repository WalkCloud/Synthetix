import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

function extractMarkerFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (body.includes("|")) {
    const parts = body.split("|");
    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf("=");
      if (eqIdx > 0) {
        fields[parts[i].slice(0, eqIdx).trim()] = parts[i].slice(eqIdx + 1).trim();
      }
    }
  } else {
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        fields[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  }
  return fields;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId, secId: sectionId } = await params;

  let body: { markerId: string; assetId: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse({ code: "invalidInput", message: "Invalid request body" }, 400);
  }

  if (!body.markerId || !body.assetId) {
    return errorResponse({ code: "invalidInput", message: "markerId and assetId are required" }, 400);
  }

  const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id } });
  if (!draft) {
    return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
  }

  const section = await db.section.findFirst({ where: { id: sectionId, draftId } });
  if (!section) {
    return errorResponse({ code: "sectionNotFound", message: "Section not found" }, 404);
  }

  const asset = await db.sectionAsset.findFirst({
    where: { id: body.assetId, draftId, sectionId },
  });
  if (!asset) {
    return errorResponse({ code: "notFound", message: "Asset not found" }, 404);
  }

  const content = section.content || "";
  const escapedMarkerId = body.markerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const requestRe = new RegExp(
    `\\[(IMAGE_REQUEST|DIAGRAM_REQUEST):[\\s\\S]*?id=${escapedMarkerId}[\\s\\S]*?\\]`
  );
  const assetRe = new RegExp(
    `\\[(IMAGE|DIAGRAM):[\\s\\S]*?\\|id=${escapedMarkerId}[\\s\\S]*?\\]`
  );

  let match = content.match(requestRe);
  let source: "request" | "asset" = "request";

  if (!match) {
    match = content.match(assetRe);
    source = "asset";
  }

  if (!match) {
    return errorResponse(`Marker not found: ${body.markerId}`, 404);
  }

  const isImageType = asset.type === "image" || asset.type === "mermaid" || asset.type === "svg";
  const tag = isImageType ? "IMAGE" : "DIAGRAM";

  let preservedFields: Record<string, string> = {};
  if (source === "request") {
    const innerRe = new RegExp(
      `\\[(IMAGE_REQUEST|DIAGRAM_REQUEST):([\\s\\S]*?)\\]`
    );
    const innerMatch = match[0].match(innerRe);
    if (innerMatch) {
      preservedFields = extractMarkerFields(innerMatch[2]);
    }
  } else {
    const innerRe = new RegExp(`\\[(IMAGE|DIAGRAM):([\\s\\S]*?)\\]`);
    const innerMatch = match[0].match(innerRe);
    if (innerMatch) {
      preservedFields = extractMarkerFields(innerMatch[2]);
    }
  }

  const restFields = { ...preservedFields };
  delete restFields.id;
  const fieldParts = Object.entries({ id: body.markerId, ...restFields })
    .map(([k, v]) => `${k}=${v}`)
    .join("|");

  const replacement = `[${tag}:${body.assetId}|${fieldParts}]`;

  const updatedContent = content.replace(
    source === "request" ? requestRe : assetRe,
    replacement
  );

  if (updatedContent === content) {
    console.error("[confirm-asset] marker replacement unchanged", { markerId: body.markerId, assetId: body.assetId, replacementLength: replacement.length, sourceLength: source.length });
    return errorResponse({ code: "notFound", message: "Marker replacement failed" }, 404);
  }

  await db.section.update({
    where: { id: sectionId },
    data: { content: updatedContent },
  });

  return successResponse({ success: true, content: updatedContent });
}
