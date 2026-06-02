import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";
import { toProviderDto } from "@/lib/models/provider-dto";
import { providerUpdateSchema } from "@/lib/models/provider-schema";
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
  return successResponse(toProviderDto(provider));
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid request body", 400);
  }

  const parsed = providerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { name, providerType, apiBaseUrl, apiKey, models } = parsed.data;

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

  if (models && models.length > 0) {
    await db.modelConfig.deleteMany({ where: { providerId: id } });
    updateData.models = {
      create: models.map((m) => ({
        modelId: m.modelId,
        modelName: m.modelName,
        capabilities: JSON.stringify(m.capabilities),
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens ?? null,
        supportsStreaming: m.supportsStreaming,
        inputPrice: m.inputPrice ?? null,
        outputPrice: m.outputPrice ?? null,
        localOrCloud: m.localOrCloud,
        isDefaultFor: m.isDefaultFor ?? null,
        embeddingBatchSize: m.embeddingBatchSize ?? null,
        embeddingDim: m.embeddingDim ?? null,
      })),
    };
  }

  const provider = await db.modelProvider.update({
    where: { id },
    data: updateData,
    include: { models: true },
  });

  return successResponse(toProviderDto(provider));
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
