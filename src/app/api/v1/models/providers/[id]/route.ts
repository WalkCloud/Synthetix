import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const provider = await db.modelProvider.findFirst({
    where: { id, userId: user.id },
    include: { models: true },
  });

  if (!provider) {
    return errorResponse("Provider not found", 404);
  }
  return successResponse(provider);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const body = await request.json();
  const { name, providerType, apiBaseUrl, apiKey, models } = body;

  const existing = await db.modelProvider.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return errorResponse("Provider not found", 404);
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (providerType !== undefined) updateData.providerType = providerType;
  if (apiBaseUrl !== undefined) updateData.apiBaseUrl = apiBaseUrl;
  if (apiKey) updateData.apiKey = encrypt(apiKey);

  if (Array.isArray(models) && models.length > 0) {
    await db.modelConfig.deleteMany({ where: { providerId: id } });
    updateData.models = {
      create: models.map((m: Record<string, unknown>) => ({
        modelId: m.modelId as string,
        modelName: m.modelName as string,
        capabilities: JSON.stringify(m.capabilities ?? []),
        contextWindow: (m.contextWindow as number) || 0,
        maxOutputTokens: (m.maxOutputTokens as number | null) ?? null,
        supportsStreaming: (m.supportsStreaming as boolean) ?? true,
        inputPrice: (m.inputPrice as number | null) ?? null,
        outputPrice: (m.outputPrice as number | null) ?? null,
        localOrCloud: (m.localOrCloud as string) || "local",
        isDefaultFor: (m.isDefaultFor as string | null) ?? null,
        embeddingBatchSize: (m.embeddingBatchSize as number | null) ?? null,
      })),
    };
  }

  const provider = await db.modelProvider.update({
    where: { id },
    data: updateData,
    include: { models: true },
  });

  return successResponse(provider);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const existing = await db.modelProvider.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return errorResponse("Provider not found", 404);
  }

  await db.modelProvider.delete({ where: { id } });
  return successResponse({ success: true });
}
