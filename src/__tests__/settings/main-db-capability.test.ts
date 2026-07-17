import { describe, expect, it } from "vitest";
import {
  MAIN_POSTGRES_UNSUPPORTED_MESSAGE,
  assertSupportedMainDatabase,
  detectUnsupportedMainPostgres,
  isPostgresDatabaseUrl,
} from "@/lib/settings/main-db-capability";

describe("main database capability", () => {
  it("accepts SQLite main database configuration", () => {
    expect(isPostgresDatabaseUrl("file:./dev.db")).toBe(false);
    expect(detectUnsupportedMainPostgres({ databaseUrl: "file:./dev.db" })).toBe(false);
    expect(() => assertSupportedMainDatabase({ databaseUrl: "file:./dev.db" })).not.toThrow();
  });

  it.each([
    "postgresql://app:secret@db/synthetix",
    "postgres://app:secret@db/synthetix",
    "POSTGRESQL://app:secret@db/synthetix",
  ])("rejects unsupported main database URL %s", (databaseUrl) => {
    expect(isPostgresDatabaseUrl(databaseUrl)).toBe(true);
    expect(() => assertSupportedMainDatabase({ databaseUrl })).toThrow(MAIN_POSTGRES_UNSUPPORTED_MESSAGE);
  });

  it("detects legacy user and global PostgreSQL selections", () => {
    expect(detectUnsupportedMainPostgres({ userDbType: "postgresql" })).toBe(true);
    expect(detectUnsupportedMainPostgres({ globalDbType: "postgresql" })).toBe(true);
  });

  it("does not classify LightRAG PostgreSQL environment names", () => {
    expect(detectUnsupportedMainPostgres({ databaseUrl: undefined })).toBe(false);
  });
});
