import { db } from "@/lib/db";
import { resolveModel } from "@/lib/llm/resolve-model";

interface ModelWithProvider {
  id: string;
  modelId: string;
  provider: {
    apiBaseUrl: string;
    apiKey: string;
    providerType: string;
  };
}

export async function resolveModelOrFallback(
  modelConfigId: string | undefined,
  module: string,
  userId?: string,
): Promise<ModelWithProvider> {
  if (modelConfigId) {
    const record = await db.modelConfig.findUnique({
      where: { id: modelConfigId },
      include: { provider: true },
    });
    if (record?.provider) return record as ModelWithProvider;
  }
  const record = await resolveModel(module, userId);
  if (!record?.provider) {
    throw new Error(`No default ${module} model configured. Set a default model in settings.`);
  }
  return record as ModelWithProvider;
}

export async function resolveSecondModel(
  excludeId: string,
  userId?: string,
): Promise<ModelWithProvider> {
  const record = await db.modelConfig.findFirst({
    where: {
      id: { not: excludeId },
      capabilities: { contains: "chat" },
      ...(userId ? { provider: { userId } } : {}),
    },
    include: { provider: true },
  });
  if (!record?.provider) {
    throw new Error("No second model available for comparison. Add another chat-capable model in settings.");
  }
  return record as ModelWithProvider;
}
