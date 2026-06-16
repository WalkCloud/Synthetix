/**
 * One-shot read-only snapshot of TokenUsage aggregates — meant to be the
 * baseline you compare against after running for a week with the P0 token-
 * accounting fixes (LightRAG graph, dimension probe, suggest-mermaid, etc.)
 * actually emitting rows.
 *
 * Mirrors the math in src/app/api/v1/models/usage/route.ts (summary +
 * byModule + byModel + modelsUsed) so the numbers match the UI exactly.
 *
 * Usage:
 *   npx tsx scripts/snapshot-token-usage.mts             # all-time
 *   npx tsx scripts/snapshot-token-usage.mts --days 7    # last 7 days
 */
import { db } from "../src/lib/db";

function parseDays(): number | null {
  const idx = process.argv.indexOf("--days");
  if (idx < 0) return null;
  const v = Number(process.argv[idx + 1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function main(): Promise<void> {
  const days = parseDays();
  const where = days
    ? { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } }
    : undefined;

  const label = days ? `last ${days} day(s)` : "all-time";
  console.log(`Token-usage snapshot — ${label}\n${"=".repeat(60)}`);

  const totals = await db.tokenUsage.aggregate({
    where,
    _sum: { inputTokens: true, outputTokens: true },
    _count: true,
  });
  const totalInput = totals._sum.inputTokens ?? 0;
  const totalOutput = totals._sum.outputTokens ?? 0;
  console.log(
    `Summary: ${totals._count} call(s), input=${totalInput.toLocaleString()}, output=${totalOutput.toLocaleString()}, total=${(totalInput + totalOutput).toLocaleString()}`,
  );

  const byModule = await db.tokenUsage.groupBy({
    by: ["module"],
    where,
    _sum: { inputTokens: true, outputTokens: true },
    _count: true,
  });
  console.log(`\nByModule (${byModule.length}):`);
  for (const r of byModule.sort(
    (a, b) =>
      (b._sum.inputTokens ?? 0) +
      (b._sum.outputTokens ?? 0) -
      ((a._sum.inputTokens ?? 0) + (a._sum.outputTokens ?? 0)),
  )) {
    const ti = r._sum.inputTokens ?? 0;
    const to = r._sum.outputTokens ?? 0;
    console.log(
      `  ${r.module.padEnd(14)}  calls=${String(r._count).padStart(5)}  in=${ti.toLocaleString().padStart(10)}  out=${to.toLocaleString().padStart(10)}`,
    );
  }

  const byModelRaw = await db.tokenUsage.groupBy({
    by: ["modelConfigId"],
    where,
    _sum: { inputTokens: true, outputTokens: true },
    _count: true,
  });
  const knownIds = byModelRaw
    .map((r) => r.modelConfigId)
    .filter((v): v is string => v !== null);
  const known = await db.modelConfig.findMany({
    where: { id: { in: knownIds } },
    select: { id: true, modelName: true, provider: { select: { name: true } } },
  });
  const knownMap = new Map(known.map((m) => [m.id, m]));

  console.log(`\nByModel (${byModelRaw.length}, modelsUsed=${knownIds.length}):`);
  for (const r of byModelRaw.sort(
    (a, b) =>
      (b._sum.inputTokens ?? 0) +
      (b._sum.outputTokens ?? 0) -
      ((a._sum.inputTokens ?? 0) + (a._sum.outputTokens ?? 0)),
  )) {
    const ti = r._sum.inputTokens ?? 0;
    const to = r._sum.outputTokens ?? 0;
    if (r.modelConfigId === null) {
      console.log(
        `  [Unattributed]                                  calls=${String(r._count).padStart(5)}  in=${ti.toLocaleString().padStart(10)}  out=${to.toLocaleString().padStart(10)}`,
      );
      continue;
    }
    const m = knownMap.get(r.modelConfigId);
    const name = m ? `${m.modelName} (${m.provider.name})` : `[deleted ${r.modelConfigId.slice(0, 8)}]`;
    console.log(
      `  ${name.padEnd(46)}  calls=${String(r._count).padStart(5)}  in=${ti.toLocaleString().padStart(10)}  out=${to.toLocaleString().padStart(10)}`,
    );
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
