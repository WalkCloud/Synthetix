import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import {
  modelMatchesDefaultSlot,
  normalizeDefaultSlot,
  type DefaultSlot,
} from "@/lib/llm/default-slot";

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

  const defaultFor: DefaultSlot | null = normalizeDefaultSlot(body.defaultFor);
  if (!defaultFor) {
    return errorResponse(
      { code: "invalidSlot", message: `Unknown defaultFor value: ${body.defaultFor}` },
      400,
    );
  }

  if (body.setDefault) {
    if (!modelMatchesDefaultSlot(modelConfig.capabilities, defaultFor)) {
      return errorResponse(
        {
          code: "capabilityMismatch",
          message: `Model ${modelConfig.modelName} (capabilities=${modelConfig.capabilities}) cannot be set as default for slot "${defaultFor}".`,
        },
        400,
      );
    }

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
