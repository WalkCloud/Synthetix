import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { ApiResponse } from "@/types/api";

interface MigrationRow {
  migration_name: string;
  finished_at: string | null;
  rolled_back_at: string | null;
}

export async function GET(): Promise<NextResponse<ApiResponse<MigrationRow[]>>> {
  try {
    const rows = await db.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY started_at ASC
    `;
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch migrations";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
