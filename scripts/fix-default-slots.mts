/**
 * One-shot cleanup: clear `isDefaultFor` on rows whose capabilities don't match
 * the slot they're assigned to. This matters because the prior route allowed
 * (e.g.) a `rerank`-only model to be saved as the LLM default — see
 * src/lib/llm/default-slot.ts for the canonical capability→slot mapping.
 *
 * Two-phase by design:
 *   - default (no flags)        → dry-run; prints every row that would change
 *   - --apply                   → actually clear `isDefaultFor = null` on mismatches
 *
 * Run with:
 *   npx tsx scripts/fix-default-slots.mts          # dry run
 *   npx tsx scripts/fix-default-slots.mts --apply  # commit
 */
import { db } from "../src/lib/db";
import {
  modelMatchesDefaultSlot,
  normalizeDefaultSlot,
  type DefaultSlot,
} from "../src/lib/llm/default-slot";

interface Mismatch {
  id: string;
  modelName: string;
  capabilities: string;
  isDefaultFor: string;
  reason: "unknownSlot" | "capabilityMismatch";
  providerName: string;
  userId: string;
}

async function findMismatches(): Promise<Mismatch[]> {
  const rows = await db.modelConfig.findMany({
    where: { NOT: { isDefaultFor: null } },
    select: {
      id: true,
      modelName: true,
      capabilities: true,
      isDefaultFor: true,
      provider: { select: { name: true, userId: true } },
    },
  });

  const mismatches: Mismatch[] = [];
  for (const r of rows) {
    const slot: DefaultSlot | null = normalizeDefaultSlot(r.isDefaultFor);
    if (!slot) {
      mismatches.push({
        id: r.id,
        modelName: r.modelName,
        capabilities: r.capabilities,
        isDefaultFor: r.isDefaultFor ?? "",
        reason: "unknownSlot",
        providerName: r.provider.name,
        userId: r.provider.userId,
      });
      continue;
    }
    if (!modelMatchesDefaultSlot(r.capabilities, slot)) {
      mismatches.push({
        id: r.id,
        modelName: r.modelName,
        capabilities: r.capabilities,
        isDefaultFor: r.isDefaultFor!,
        reason: "capabilityMismatch",
        providerName: r.provider.name,
        userId: r.provider.userId,
      });
    }
  }
  return mismatches;
}

function printTable(rows: Mismatch[]): void {
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const r of rows) {
    console.log(
      `  ${r.id.slice(0, 8)}  modelName=${r.modelName.padEnd(28)}  caps=${r.capabilities.padEnd(20)}  isDefaultFor=${r.isDefaultFor.padEnd(10)}  reason=${r.reason}  provider=${r.providerName}  user=${r.userId.slice(0, 8)}`,
    );
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const mismatches = await findMismatches();

  console.log(`Found ${mismatches.length} mismatched default-slot rows:`);
  printTable(mismatches);

  if (mismatches.length === 0) {
    console.log("\nNothing to fix.");
    await db.$disconnect();
    return;
  }

  if (!apply) {
    console.log(
      "\nDry run only — no changes written. Re-run with --apply to clear isDefaultFor on the rows above.",
    );
    await db.$disconnect();
    return;
  }

  const ids = mismatches.map((m) => m.id);
  const result = await db.modelConfig.updateMany({
    where: { id: { in: ids } },
    data: { isDefaultFor: null },
  });
  console.log(`\nCleared isDefaultFor on ${result.count} row(s).`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
