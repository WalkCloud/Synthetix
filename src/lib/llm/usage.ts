import { db } from "@/lib/db";

interface TokenUsageParams {
  userId: string;
  modelConfigId?: string;
  module: string;
  inputTokens: number;
  outputTokens: number;
  referenceId?: string;
}

export async function recordTokenUsage(params: TokenUsageParams): Promise<void> {
  if (params.inputTokens === 0 && params.outputTokens === 0) return;

  await db.tokenUsage.create({
    data: {
      userId: params.userId,
      modelConfigId: params.modelConfigId,
      module: params.module,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      referenceId: params.referenceId,
    },
  });
}

export async function recordTokenUsageSafely(params: TokenUsageParams): Promise<void> {
  try { await recordTokenUsage(params); } catch (err) {
    console.warn("Failed to record token usage:", err);
  }
}
