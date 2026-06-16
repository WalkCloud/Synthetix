import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { searchParams } = new URL(request.url);
  const usageModule = searchParams.get("module");
  const days = parseInt(searchParams.get("days") || "30");

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where = {
    userId: user.id,
    createdAt: { gte: since },
    ...(usageModule && { module: usageModule }),
  };

  const [usage, byModelRaw, byModuleRaw, summaryRaw] =
    await Promise.all([
      db.tokenUsage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          modelConfig: {
            select: {
              modelName: true,
              provider: { select: { name: true } },
            },
          },
        },
      }),
      db.tokenUsage.groupBy({
        by: ["modelConfigId"],
        where,
        _sum: { inputTokens: true, outputTokens: true },
        _count: true,
      }),
      db.tokenUsage.groupBy({
        by: ["module"],
        where,
        _sum: { inputTokens: true, outputTokens: true },
        _count: true,
      }),
      db.tokenUsage.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true },
        _count: true,
      }),
    ]);

  const entries = usage.map((u) => ({
    id: u.id,
    module: u.module,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    createdAt: u.createdAt.toISOString(),
    modelName: u.modelConfig?.modelName ?? null,
    providerName: u.modelConfig?.provider?.name ?? null,
  }));

  const modelConfigIds = byModelRaw
    .map((r) => r.modelConfigId)
    .filter((id): id is string => id !== null);

  const modelConfigs = modelConfigIds.length > 0
    ? await db.modelConfig.findMany({
        where: { id: { in: modelConfigIds } },
        select: {
          id: true,
          modelName: true,
          provider: { select: { name: true } },
        },
      })
    : [];

  const modelLookup = new Map(
    modelConfigs.map((mc) => [
      mc.id,
      { modelName: mc.modelName, providerName: mc.provider.name },
    ]),
  );

  // Keep rows whose modelConfigId is null as a synthetic "unattributed" bucket
  // so byModel totals reconcile to the summary totals. This used to be silently
  // discarded — Python LightRAG / legacy rows never have a modelConfigId, so
  // dropping them made byModel sums smaller than the summary every time.
  const byModel = byModelRaw.map((r) => {
    if (r.modelConfigId === null) {
      return {
        modelConfigId: null,
        modelName: "Unattributed",
        providerName: "",
        totalInputTokens: r._sum.inputTokens ?? 0,
        totalOutputTokens: r._sum.outputTokens ?? 0,
        totalCalls: r._count,
      };
    }
    const info = modelLookup.get(r.modelConfigId) ?? {
      modelName: "Unknown",
      providerName: "",
    };
    return {
      modelConfigId: r.modelConfigId,
      modelName: info.modelName,
      providerName: info.providerName,
      totalInputTokens: r._sum.inputTokens ?? 0,
      totalOutputTokens: r._sum.outputTokens ?? 0,
      totalCalls: r._count,
    };
  });

  byModel.sort(
    (a, b) =>
      b.totalInputTokens +
      b.totalOutputTokens -
      (a.totalInputTokens + a.totalOutputTokens),
  );

  const byModule = byModuleRaw
    .map((r) => ({
      module: r.module,
      totalInputTokens: r._sum.inputTokens ?? 0,
      totalOutputTokens: r._sum.outputTokens ?? 0,
      totalCalls: r._count,
    }))
    .sort(
      (a, b) =>
        b.totalInputTokens +
        b.totalOutputTokens -
        (a.totalInputTokens + a.totalOutputTokens),
    );

  const modelsUsed = byModel.length;

  return successResponse({
    entries,
    byModel,
    byModule,
    summary: {
      totalInputTokens: summaryRaw._sum.inputTokens ?? 0,
      totalOutputTokens: summaryRaw._sum.outputTokens ?? 0,
      totalCalls: summaryRaw._count,
      modelsUsed,
    },
  });
}
