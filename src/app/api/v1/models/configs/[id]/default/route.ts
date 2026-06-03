import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { parseCapabilities } from "@/lib/llm/capabilities";

type DefaultSlot = "llm" | "embedding" | "image";

function normalizeDefaultSlot(value: unknown): DefaultSlot {
  return value === "embedding" || value === "image" || value === "llm"
    ? value
    : "llm";
}

function modelMatchesDefaultSlot(rawCapabilities: unknown, slot: DefaultSlot): boolean {
  const caps = parseCapabilities(rawCapabilities);
  if (slot === "embedding") {
    return caps.some((c) => c === "embedding" || c === "embed");
  }
  if (slot === "image") {
    return caps.includes("image_generation");
  }
  return !caps.some((c) => c === "embedding" || c === "embed" || c === "image_generation");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: modelConfigId } = await params;
  let body: { setDefault?: boolean; defaultFor?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const modelConfig = await db.modelConfig.findUnique({
    where: { id: modelConfigId },
    include: { provider: true },
  });

  if (!modelConfig || modelConfig.provider.userId !== user.id) {
    return errorResponse({ code: "notFound", message: "Model config not found" }, 404);
  }

  const defaultFor = normalizeDefaultSlot(body.defaultFor);

  if (body.setDefault) {
    await db.modelConfig.updateMany({
      where: {
        isDefaultFor: defaultFor,
        provider: { userId: user.id },
      },
      data: { isDefaultFor: null },
    });

    const legacyDefaults = await db.modelConfig.findMany({
      where: {
        isDefaultFor: "default",
        provider: { userId: user.id },
      },
      select: { id: true, capabilities: true },
    });
    const legacyIdsToClear = legacyDefaults
      .filter((model) => modelMatchesDefaultSlot(model.capabilities, defaultFor))
      .map((model) => model.id);
    if (legacyIdsToClear.length > 0) {
      await db.modelConfig.updateMany({
        where: { id: { in: legacyIdsToClear } },
        data: { isDefaultFor: null },
      });
    }

    await db.modelConfig.update({
      where: { id: modelConfigId },
      data: { isDefaultFor: defaultFor },
    });
  } else {
    await db.modelConfig.update({
      where: { id: modelConfigId },
      data: { isDefaultFor: null },
    });
  }

  const updated = await db.modelConfig.findUnique({
    where: { id: modelConfigId },
  });

  return successResponse(updated);
}
