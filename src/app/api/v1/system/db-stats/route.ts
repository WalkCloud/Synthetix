import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, successResponse, errorResponse } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { readDbGlobalConfig } from "@/lib/settings/db-config";
import fsSync from "node:fs";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "dev.db");

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  try {
    const globalConfig = readDbGlobalConfig();
    const isPg = globalConfig?.dbType === "postgresql";
    const dbType = isPg ? "postgresql" : "sqlite";

    let dbSizeBytes = 0;
    let walSizeBytes = 0;
    let version = "";
    let integrityOk = true;

    if (!isPg) {
      try {
        const stat = fsSync.statSync(DB_PATH);
        dbSizeBytes = stat.size;
      } catch (e) { console.error("[db-stats] stat db file:", e); }
      try {
        const walStat = fsSync.statSync(DB_PATH + "-wal");
        walSizeBytes = walStat.size;
      } catch { /* no WAL */ }

      try {
        const rows = await db.$queryRawUnsafe<[{ version: string }]>("SELECT sqlite_version() as version");
        version = rows[0]?.version || "";
      } catch { /* ignore */ }

      try {
        const raw = await db.$queryRawUnsafe<Record<string, string>[]>("PRAGMA integrity_check");
        integrityOk = raw.length > 0 && Object.values(raw[0])[0] === "ok";
      } catch { /* ignore */ }
    }

    return successResponse({
      dbType,
      isPg,
      version: isPg ? "" : version,
      dbSizeBytes,
      walSizeBytes,
      integrityOk,
    });
  } catch (e) {
    console.error("[db-stats] unhandled error:", e);
    return errorResponse(e instanceof Error ? e.message : "Failed to load database stats", 500);
  }
}
