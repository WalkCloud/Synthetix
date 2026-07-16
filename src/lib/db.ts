import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { readDbGlobalConfig } from "@/lib/settings/db-config";
import { assertSupportedMainDatabase } from "@/lib/settings/main-db-capability";
import { resolvePrismaUrl } from "@/lib/db-path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const globalConfig = readDbGlobalConfig();
  assertSupportedMainDatabase({
    databaseUrl: process.env.DATABASE_URL,
    globalDbType: globalConfig?.dbType,
  });

  const adapter = new PrismaBetterSqlite3({
    url: resolvePrismaUrl(),
  });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
