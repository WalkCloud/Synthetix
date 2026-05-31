import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readDbGlobalConfig, buildPgConnectionString } from "@/lib/settings/db-config";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const globalConfig = readDbGlobalConfig();

  if (globalConfig && globalConfig.dbType === "postgresql") {
    const connectionString = buildPgConnectionString(globalConfig);
    const pool = new Pool({ connectionString, max: 10 });
    return new PrismaClient({ adapter: new PrismaPg(pool) });
  }

  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || "file:./dev.db",
  });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
