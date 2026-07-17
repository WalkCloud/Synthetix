export const SUPPORTED_MAIN_DB_TYPES = ["sqlite"] as const;
export const MAIN_POSTGRES_SUPPORTED = false;

export const MAIN_POSTGRES_UNSUPPORTED_MESSAGE =
  "Main PostgreSQL is not supported by this build. Use SQLite for the main application database. LightRAG pgvector remains supported.";

export function isPostgresDatabaseUrl(value: string | undefined): boolean {
  return /^postgres(?:ql)?:\/\//i.test(value?.trim() ?? "");
}

export function detectUnsupportedMainPostgres(input: {
  databaseUrl?: string;
  userDbType?: string;
  globalDbType?: string | null;
}): boolean {
  return input.userDbType === "postgresql"
    || input.globalDbType === "postgresql"
    || isPostgresDatabaseUrl(input.databaseUrl);
}

export function assertSupportedMainDatabase(input: {
  databaseUrl?: string;
  globalDbType?: string | null;
}): void {
  if (detectUnsupportedMainPostgres(input)) {
    throw new Error(MAIN_POSTGRES_UNSUPPORTED_MESSAGE);
  }
}
