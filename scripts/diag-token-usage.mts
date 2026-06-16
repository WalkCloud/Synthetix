// Diagnostic script to inspect token_usage table.
// Reuses the app's own db.ts so adapter/url resolution matches production.
import { db } from "../src/lib/db";

async function main() {
  console.log("\n=== 1) Total rows in token_usage ===");
  const total = await db.tokenUsage.count();
  console.log("count:", total);

  console.log("\n=== 2) Distribution by module ===");
  const byModule = await db.tokenUsage.groupBy({
    by: ["module"],
    _count: true,
    _sum: { inputTokens: true, outputTokens: true },
  });
  byModule.sort((a, b) => b._count - a._count);
  for (const r of byModule) {
    console.log(
      `  ${r.module.padEnd(15)} rows=${String(r._count).padStart(5)}  in=${String(r._sum.inputTokens ?? 0).padStart(9)}  out=${String(r._sum.outputTokens ?? 0).padStart(9)}`,
    );
  }

  console.log("\n=== 3) modelConfigId NULL count ===");
  const nullCount = await db.tokenUsage.count({ where: { modelConfigId: null } });
  console.log("rows with modelConfigId=NULL:", nullCount);

  console.log("\n=== 4) Distinct modelConfigIds vs valid ModelConfig ===");
  const distinctIds = await db.tokenUsage.findMany({
    distinct: ["modelConfigId"],
    select: { modelConfigId: true },
  });
  console.log("distinct modelConfigIds in token_usage:", distinctIds.length);

  for (const { modelConfigId } of distinctIds) {
    if (!modelConfigId) {
      const c = await db.tokenUsage.count({ where: { modelConfigId: null } });
      console.log(`  NULL  -> ${c} rows`);
      continue;
    }
    const mc = await db.modelConfig.findUnique({
      where: { id: modelConfigId },
      select: {
        id: true,
        modelName: true,
        modelId: true,
        capabilities: true,
        provider: { select: { name: true } },
      },
    });
    const c = await db.tokenUsage.count({ where: { modelConfigId } });
    if (!mc) {
      console.log(`  ${modelConfigId.slice(0, 8)}…  -> ${c} rows  [ORPHAN — ModelConfig deleted]`);
    } else {
      console.log(
        `  ${modelConfigId.slice(0, 8)}…  -> ${String(c).padStart(4)} rows  modelName=${mc.modelName.padEnd(28)} (${mc.modelId.padEnd(28)})  provider=${mc.provider.name.padEnd(15)}  caps=${mc.capabilities}`,
      );
    }
  }

  console.log("\n=== 5) Latest 15 token_usage rows ===");
  const recent = await db.tokenUsage.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    include: {
      modelConfig: { select: { modelName: true, capabilities: true } },
    },
  });
  for (const r of recent) {
    console.log(
      `  ${r.createdAt.toISOString()}  ${r.module.padEnd(12)}  in=${String(r.inputTokens).padStart(7)}  out=${String(r.outputTokens).padStart(7)}  model=${r.modelConfig?.modelName ?? "(null)"}  caps=${r.modelConfig?.capabilities ?? "-"}`,
    );
  }

  console.log("\n=== 6) Tokens grouped by modelConfigId (mirror of /api/v1/models/usage logic) ===");
  const byModel = await db.tokenUsage.groupBy({
    by: ["modelConfigId"],
    _sum: { inputTokens: true, outputTokens: true },
    _count: true,
  });
  let summaryTotal = 0;
  let dropped = 0;
  let orphan = 0;
  for (const r of byModel) {
    const total = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
    summaryTotal += total;
    const mc = r.modelConfigId
      ? await db.modelConfig.findUnique({
          where: { id: r.modelConfigId },
          select: { modelName: true, provider: { select: { name: true } } },
        })
      : null;
    let label;
    if (!r.modelConfigId) {
      label = "(NULL — silently dropped by API .filter(modelConfigId !== null))";
      dropped += total;
    } else if (!mc) {
      label = `${r.modelConfigId.slice(0, 8)}… (orphan — shows as 'Unknown' in UI)`;
      orphan += total;
    } else {
      label = `${mc.modelName} / ${mc.provider.name}`;
    }
    console.log(`  ${String(total).padStart(9)} tokens  rows=${String(r._count).padStart(4)}  ${label}`);
  }
  console.log(`  ────────────────`);
  console.log(`  total in DB: ${summaryTotal}`);
  console.log(`  dropped from byModel by null filter: ${dropped} (${summaryTotal > 0 ? ((dropped / summaryTotal) * 100).toFixed(1) : 0}%)`);
  console.log(`  orphan (showing as 'Unknown'):       ${orphan}`);

  console.log("\n=== 7) Possible duplicate writing records (same user/model/in/out within 30s) ===");
  const writingRows = await db.tokenUsage.findMany({
    where: { module: "writing" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      modelConfigId: true,
      inputTokens: true,
      outputTokens: true,
      createdAt: true,
    },
  });
  let dupRows = 0;
  let dupTokens = 0;
  for (let i = 0; i < writingRows.length; i++) {
    for (let j = i + 1; j < writingRows.length; j++) {
      const a = writingRows[i];
      const b = writingRows[j];
      if (a.userId !== b.userId) break;
      const dt = b.createdAt.getTime() - a.createdAt.getTime();
      if (dt > 30_000) break;
      if (
        a.inputTokens === b.inputTokens &&
        a.outputTokens === b.outputTokens &&
        a.modelConfigId === b.modelConfigId &&
        a.inputTokens + a.outputTokens > 0
      ) {
        dupRows++;
        dupTokens += b.inputTokens + b.outputTokens;
      }
    }
  }
  console.log(`  writing rows total: ${writingRows.length}`);
  console.log(`  likely-duplicate rows: ${dupRows}  (~${dupTokens} excess tokens)`);

  console.log("\n=== 8) ModelConfig table summary ===");
  const allConfigs = await db.modelConfig.findMany({
    select: { id: true, modelName: true, modelId: true, capabilities: true, provider: { select: { name: true } } },
  });
  console.log(`  total ModelConfig rows: ${allConfigs.length}`);
  for (const mc of allConfigs) {
    const used = await db.tokenUsage.count({ where: { modelConfigId: mc.id } });
    console.log(
      `  ${mc.id.slice(0, 8)}…  modelName=${mc.modelName.padEnd(30)} (${mc.modelId.padEnd(28)})  provider=${mc.provider.name.padEnd(12)}  caps=${mc.capabilities.padEnd(20)}  usage_rows=${used}`,
    );
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
