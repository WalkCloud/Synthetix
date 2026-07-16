import { db } from "@/lib/db";
import {
  compareTaskIdentitySources,
  type LegacyTaskIdentity,
} from "@/lib/queue/task-identity-legacy";

export interface AsyncTaskIdentityBackfillStats {
  scanned: number;
  updated: number;
  malformed: number;
  ambiguous: number;
  mismatch: number;
  null: number;
}

export interface BackfillAsyncTaskIdentityOptions {
  batchSize?: number;
  dryRun?: boolean;
  onPage?: (page: AsyncTaskIdentityBackfillStats & {
    pageNumber: number;
    lastId: string | null;
  }) => void | Promise<void>;
}

const TARGET_FIELDS = ["documentId", "draftId", "sectionId", "sessionId", "attempt"] as const;

function emptyStats(): AsyncTaskIdentityBackfillStats {
  return { scanned: 0, updated: 0, malformed: 0, ambiguous: 0, mismatch: 0, null: 0 };
}

function addStats(target: AsyncTaskIdentityBackfillStats, source: AsyncTaskIdentityBackfillStats): void {
  for (const key of Object.keys(target) as (keyof AsyncTaskIdentityBackfillStats)[]) {
    target[key] += source[key];
  }
}

function validateBatchSize(value: number | undefined): number {
  const batchSize = value ?? 200;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("batchSize must be an integer from 1 to 1000");
  }
  return batchSize;
}

export async function backfillAsyncTaskIdentity(
  options: BackfillAsyncTaskIdentityOptions = {},
): Promise<AsyncTaskIdentityBackfillStats> {
  const batchSize = validateBatchSize(options.batchSize);
  const total = emptyStats();
  const scanStartedAt = new Date();
  let lastId: string | null = null;
  let pageNumber = 0;

  while (true) {
    const rows: Array<{
      id: string;
      type: string;
      inputData: string | null;
      documentId: string | null;
      draftId: string | null;
      sectionId: string | null;
      sessionId: string | null;
      attempt: number | null;
    }> = await db.asyncTask.findMany({
      where: {
        createdAt: { lte: scanStartedAt },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        type: true,
        inputData: true,
        documentId: true,
        draftId: true,
        sectionId: true,
        sessionId: true,
        attempt: true,
      },
    });
    if (rows.length === 0) break;

    pageNumber += 1;
    const page = emptyStats();
    for (const row of rows) {
      page.scanned += 1;
      const comparison = compareTaskIdentitySources(row);
      if (comparison.legacy.status === "malformed") page.malformed += 1;
      if (comparison.legacy.status === "ambiguous") page.ambiguous += 1;
      if (comparison.mismatches.length > 0) page.mismatch += 1;

      let wouldUpdate = false;
      if (comparison.legacy.status === "parsed") {
        for (const field of TARGET_FIELDS) {
          const value = comparison.legacy.identity[field];
          if (row[field] !== null || value === null) continue;
          wouldUpdate = true;
          if (!options.dryRun) {
            await db.asyncTask.updateMany({
              where: { id: row.id, [field]: null },
              data: { [field]: value },
            });
          }
        }
      }
      if (wouldUpdate) page.updated += 1;

      const effective = options.dryRun
        ? row
        : {
            ...row,
            ...Object.fromEntries(TARGET_FIELDS.map((field) => [
              field,
              row[field] ?? comparison.legacy.identity[field],
            ])),
          };
      if (TARGET_FIELDS.some((field) => effective[field] === null)) page.null += 1;
    }

    addStats(total, page);
    lastId = rows[rows.length - 1].id;
    await options.onPage?.({ ...page, pageNumber, lastId });
  }

  return total;
}
