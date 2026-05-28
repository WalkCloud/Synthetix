import { db } from "@/lib/db";
import { errorResponse, successResponse } from "@/lib/api-helpers";

interface MigrationRow {
  migration_name: string;
  finished_at: string | null;
  rolled_back_at: string | null;
}

export async function GET() {
  try {
    const rows = await db.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY started_at ASC
    `;
    return successResponse(rows);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("no such table") && msg.includes("_prisma_migrations")) {
      return successResponse([]);
    }
    return errorResponse(error);
  }
}
