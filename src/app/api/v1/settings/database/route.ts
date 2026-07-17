import { getAuthUser } from "@/lib/auth/session";
import { readSettings, writeSettings } from "@/lib/settings/store";
import { readDbGlobalConfig } from "@/lib/settings/db-config";
import { maskSecret } from "@/lib/settings/secrets";
import {
  MAIN_POSTGRES_SUPPORTED,
  MAIN_POSTGRES_UNSUPPORTED_MESSAGE,
  SUPPORTED_MAIN_DB_TYPES,
  detectUnsupportedMainPostgres,
  isPostgresDatabaseUrl,
} from "@/lib/settings/main-db-capability";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

function maskConnectionUrl(value: string): string {
  if (!value.includes("://")) return value;
  try {
    const url = new URL(value);
    if (url.password) url.password = "••••";
    return url.toString();
  } catch {
    return value.replace(/(\/\/[^:/?#]+:)[^@/]+@/, "$1••••@");
  }
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const settings = readSettings(user.id);
  const globalConfig = readDbGlobalConfig();
  const databaseUrl = process.env.DATABASE_URL;
  const unsupportedPostgresConfigDetected = detectUnsupportedMainPostgres({
    databaseUrl,
    userDbType: settings.dbType,
    globalDbType: globalConfig?.dbType,
  });
  const password = maskSecret(globalConfig?.pgPassword || settings.pgPassword);
  const dbType = settings.dbType === "postgresql"
    || globalConfig?.dbType === "postgresql"
    || isPostgresDatabaseUrl(databaseUrl)
    ? "postgresql"
    : "sqlite";

  return successResponse({
    dbType,
    supportedDbTypes: SUPPORTED_MAIN_DB_TYPES,
    mainPostgresSupported: MAIN_POSTGRES_SUPPORTED,
    unsupportedPostgresConfigDetected,
    sqlitePath: settings.sqlitePath ?? (databaseUrl?.startsWith("file:") ? databaseUrl.replace("file:", "") : "./dev.db"),
    pgHost: settings.pgHost ?? globalConfig?.pgHost ?? "",
    pgPort: settings.pgPort ?? globalConfig?.pgPort ?? 5432,
    pgDatabase: settings.pgDatabase ?? globalConfig?.pgDatabase ?? "",
    pgUser: settings.pgUser ?? globalConfig?.pgUser ?? "",
    pgPassword: password.masked,
    pgPasswordConfigured: password.configured,
    pgConfigured: globalConfig?.dbType === "postgresql" && !!globalConfig.pgHost,
    connectionUrl: maskConnectionUrl(databaseUrl ?? "file:./dev.db"),
  });
}

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json();
  if (body.dbType === "postgresql") {
    return errorResponse({
      code: "conflict",
      message: MAIN_POSTGRES_UNSUPPORTED_MESSAGE,
    }, 409);
  }

  writeSettings(user.id, {
    dbType: body.dbType,
    sqlitePath: body.sqlitePath,
  });

  return successResponse({
    saved: true,
    note: "Database connection changes require a server restart to take effect.",
  });
}
