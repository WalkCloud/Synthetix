import "dotenv/config";
import { backfillAsyncTaskIdentity } from "../src/lib/queue/task-identity-backfill";

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const quiet = process.argv.includes("--quiet");
  const batchSizeValue = readArgument("--batch-size");
  const batchSize = batchSizeValue === undefined ? undefined : Number(batchSizeValue);

  const stats = await backfillAsyncTaskIdentity({
    dryRun,
    batchSize,
    onPage: quiet ? undefined : (page) => {
      console.log(
        `[task-identity-backfill] page=${page.pageNumber} scanned=${page.scanned} updated=${page.updated} malformed=${page.malformed} ambiguous=${page.ambiguous} mismatch=${page.mismatch} null=${page.null}`,
      );
    },
  });

  console.log(
    `[task-identity-backfill] scanned=${stats.scanned} updated=${stats.updated} malformed=${stats.malformed} ambiguous=${stats.ambiguous} mismatch=${stats.mismatch} null=${stats.null} dryRun=${dryRun}`,
  );
}

main().catch((error) => {
  console.error("[task-identity-backfill] failed:", error);
  process.exitCode = 1;
});
