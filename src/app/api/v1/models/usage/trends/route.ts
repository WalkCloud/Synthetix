import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30", 10);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const usages = await db.tokenUsage.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    select: { inputTokens: true, outputTokens: true, createdAt: true, module: true },
  });

  const dayMap = new Map<string, { date: string; input: number; output: number }>();
  const moduleDayMap = new Map<string, Map<string, { input: number; output: number }>>();

  for (const u of usages) {
    const day = u.createdAt.toISOString().slice(0, 10);
    if (!dayMap.has(day)) {
      dayMap.set(day, { date: day, input: 0, output: 0 });
    }
    const entry = dayMap.get(day)!;
    entry.input += u.inputTokens;
    entry.output += u.outputTokens;

    if (!moduleDayMap.has(u.module)) {
      moduleDayMap.set(u.module, new Map());
    }
    const modMap = moduleDayMap.get(u.module)!;
    if (!modMap.has(day)) {
      modMap.set(day, { input: 0, output: 0 });
    }
    const modEntry = modMap.get(day)!;
    modEntry.input += u.inputTokens;
    modEntry.output += u.outputTokens;
  }

  const daysArray: Array<{ date: string; input: number; output: number }> = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const key = date.toISOString().slice(0, 10);
    daysArray.push(dayMap.get(key) ?? { date: key, input: 0, output: 0 });
  }

  const byModule: Record<string, Array<{ date: string; input: number; output: number }>> = {};
  for (const [module, modMap] of moduleDayMap) {
    byModule[module] = daysArray.slice(-days).map((d) => ({
      date: d.date,
      ...modMap.get(d.date) ?? { input: 0, output: 0 },
    }));
  }

  return successResponse({
    total: daysArray,
    byModule,
    summary: {
      totalInput: usages.reduce((s, u) => s + u.inputTokens, 0),
      totalOutput: usages.reduce((s, u) => s + u.outputTokens, 0),
      totalCalls: usages.length,
      days,
    },
  });
}
