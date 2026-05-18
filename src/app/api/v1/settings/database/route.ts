import { getAuthUser } from "@/lib/auth/session";
import { readSettings, writeSettings } from "@/lib/settings/store";
import { authErrorResponse, successResponse } from "@/lib/api-helpers";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const settings = readSettings(user.id);
  return successResponse({
    dbType: settings.dbType ?? (process.env.DATABASE_URL?.startsWith("postgresql") ? "postgresql" : "sqlite"),
    sqlitePath: settings.sqlitePath ?? process.env.DATABASE_URL?.replace("file:", "") ?? "./dev.db",
    pgHost: settings.pgHost ?? process.env.POSTGRES_HOST ?? "",
    pgPort: settings.pgPort ?? parseInt(process.env.POSTGRES_PORT || "5432", 10),
    pgDatabase: settings.pgDatabase ?? process.env.POSTGRES_DATABASE ?? "",
    pgUser: settings.pgUser ?? process.env.POSTGRES_USER ?? "",
    connectionUrl: process.env.DATABASE_URL ?? "file:./dev.db",
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

  return successResponse({
    saved: true,
    note: "Database connection changes require a server restart to take effect.",
  });
}
