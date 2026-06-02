import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";
import { toProviderDto } from "@/lib/models/provider-dto";
import { providerCreateSchema } from "@/lib/models/provider-schema";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const providers = await db.modelProvider.findMany({
    where: { userId: user.id },
    include: { models: true },
    orderBy: { createdAt: "desc" },
  });

  return successResponse(providers.map(toProviderDto));
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid request body", 400);
  }

  const parsed = providerCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { name, providerType, apiBaseUrl, apiKey, models } = parsed.data;

  const provider = await db.modelProvider.create({
    data: {
      userId: user.id,
      name,
      providerType,
      apiBaseUrl,
      apiKey: apiKey ? encrypt(apiKey) : null,
      models: {
        create: models.map((m) => ({
          modelId: m.modelId,
          modelName: m.modelName,
          capabilities: JSON.stringify(m.capabilities),
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          supportsStreaming: m.supportsStreaming,
          inputPrice: m.inputPrice,
          outputPrice: m.outputPrice,
          localOrCloud: m.localOrCloud,
          isDefaultFor: m.isDefaultFor,
          embeddingBatchSize: m.embeddingBatchSize,
          embeddingDim: m.embeddingDim,
        })),
      },
    },
    include: { models: true },
  });

  return successResponse(toProviderDto(provider), 201);
}
