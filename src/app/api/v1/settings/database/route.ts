import { getAuthUser } from "@/lib/auth/session";
import { readSettings, writeSettings } from "@/lib/settings/store";
import { readDbGlobalConfig, writeDbGlobalConfig } from "@/lib/settings/db-config";
import { maskSecret } from "@/lib/settings/secrets";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";

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
  const password = maskSecret(globalConfig?.pgPassword || settings.pgPassword);

  return successResponse({
    dbType: settings.dbType ?? (process.env.DATABASE_URL?.startsWith("postgresql") ? "postgresql" : "sqlite"),
    sqlitePath: settings.sqlitePath ?? process.env.DATABASE_URL?.replace("file:", "") ?? "./dev.db",
    pgHost: settings.pgHost ?? globalConfig?.pgHost ?? process.env.POSTGRES_HOST ?? "",
    pgPort: settings.pgPort ?? globalConfig?.pgPort ?? parseInt(process.env.POSTGRES_PORT || "5432", 10),
    pgDatabase: settings.pgDatabase ?? globalConfig?.pgDatabase ?? process.env.POSTGRES_DATABASE ?? "",
    pgUser: settings.pgUser ?? globalConfig?.pgUser ?? process.env.POSTGRES_USER ?? "",
    pgPassword: password.masked,
    pgPasswordConfigured: password.configured,
    pgConfigured: globalConfig?.dbType === "postgresql" && !!globalConfig.pgHost,
    connectionUrl: maskConnectionUrl(process.env.DATABASE_URL ?? "file:./dev.db"),
  });
}

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json();
  writeSettings(user.id, {
    dbType: body.dbType,
    sqlitePath: body.sqlitePath,
    pgHost: body.pgHost,
    pgPort: body.pgPort,
    pgDatabase: body.pgDatabase,
    pgUser: body.pgUser,
  });

  if (body.dbType === "postgresql" && body.pgHost && body.pgDatabase) {
    const currentGlobalConfig = readDbGlobalConfig();
    writeDbGlobalConfig({
      dbType: "postgresql",
      pgHost: body.pgHost,
      pgPort: parseInt(String(body.pgPort || "5432"), 10),
      pgDatabase: body.pgDatabase,
      pgUser: body.pgUser || "",
      pgPassword: body.pgPassword || currentGlobalConfig?.pgPassword || "",
    });
  }

  return successResponse({
    saved: true,
    note: "Database connection changes require a server restart to take effect.",
  });
}
