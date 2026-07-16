import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/settings/store";

let settings: UserSettings = {};
let globalDbConfig: Record<string, unknown> | null = null;
let lastDbWrite: Record<string, unknown> | null = null;

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => ({ id: "settings-route-user" }),
}));

vi.mock("@/lib/settings/store", () => ({
  readSettings: () => ({ ...settings }),
  writeSettings: (_userId: string, updates: Partial<UserSettings>, clearSecrets: string[] = []) => {
    settings = { ...settings, ...updates };
    for (const field of clearSecrets) delete (settings as Record<string, unknown>)[field];
  },
}));

vi.mock("@/lib/settings/db-config", () => ({
  readDbGlobalConfig: () => globalDbConfig,
  writeDbGlobalConfig: (config: Record<string, unknown>) => {
    lastDbWrite = config;
    globalDbConfig = config;
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    document: {
      aggregate: async () => ({ _sum: { originalSize: 0, markdownSize: 0 } }),
    },
  },
}));

import { GET as getRag, PUT as putRag } from "@/app/api/v1/settings/rag/route";
import { GET as getStorage, PUT as putStorage } from "@/app/api/v1/settings/storage/route";
import { GET as getDatabase, PUT as putDatabase } from "@/app/api/v1/settings/database/route";

async function json(response: Response) {
  return (await response.json()).data;
}

function putRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("settings secret routes", () => {
  beforeEach(() => {
    settings = {};
    globalDbConfig = null;
    lastDbWrite = null;
  });

  it("masks storage and RAG secrets without returning connection URLs containing credentials", async () => {
    settings = {
      s3AccessKey: "ACCESS-1234",
      s3SecretKey: "SECRET-5678",
      ragPgUrl: "postgresql://user:password@db.internal/rag",
      ragPgPassword: "rag-password",
      ragQdrantApiKey: "qdrant-key",
    };

    const storage = await json(await getStorage());
    const rag = await json(await getRag());
    const serialized = JSON.stringify({ storage, rag });

    expect(storage.s3AccessKey).toBe("••••1234");
    expect(storage.s3AccessKeyConfigured).toBe(true);
    expect(storage.s3SecretKey).toBe("••••5678");
    expect(storage.s3SecretKeyConfigured).toBe(true);
    expect(rag.ragPgUrl).toBe("");
    expect(rag.ragPgUrlConfigured).toBe(true);
    expect(rag.ragPgPasswordConfigured).toBe(true);
    expect(rag.ragQdrantApiKeyConfigured).toBe(true);
    expect(serialized).not.toContain("password@db.internal");
    expect(serialized).not.toContain("rag-password");
    expect(serialized).not.toContain("qdrant-key");
  });

  it("preserves route secrets when PUT sends empty strings", async () => {
    settings = {
      s3SecretKey: "existing-storage-secret",
      ragNeo4jPassword: "existing-neo4j-secret",
    };

    await putStorage(putRequest("http://t/api/v1/settings/storage", {
      storageType: "s3",
      s3Bucket: "documents",
      s3SecretKey: "",
    }));
    await putRag(putRequest("http://t/api/v1/settings/rag", {
      ragVectorDb: "milvus",
      ragNeo4jPassword: "",
    }));

    expect(settings.s3SecretKey).toBe("existing-storage-secret");
    expect(settings.ragNeo4jPassword).toBe("existing-neo4j-secret");
  });

  it("clears route secrets only through the explicit clearSecrets contract", async () => {
    settings = {
      s3AccessKey: "existing-access",
      s3SecretKey: "existing-storage-secret",
      ragNeo4jPassword: "existing-neo4j-secret",
    };

    const storageResponse = await putStorage(putRequest("http://t/api/v1/settings/storage", {
      storageType: "s3",
      clearSecrets: ["s3SecretKey"],
    }));
    const ragResponse = await putRag(putRequest("http://t/api/v1/settings/rag", {
      ragVectorDb: "neo4j",
      clearSecrets: ["ragNeo4jPassword"],
    }));

    expect(storageResponse.status).toBe(200);
    expect(ragResponse.status).toBe(200);
    expect(settings.s3AccessKey).toBe("existing-access");
    expect(settings.s3SecretKey).toBeUndefined();
    expect(settings.ragNeo4jPassword).toBeUndefined();
    expect((await json(await getStorage())).s3SecretKeyConfigured).toBe(false);
    expect((await json(await getRag())).ragNeo4jPasswordConfigured).toBe(false);
  });

  it("rejects unknown clear targets and replace-clear conflicts without writing", async () => {
    settings = { s3AccessKey: "existing-access" };
    const before = { ...settings };

    const unknown = await putStorage(putRequest("http://t/api/v1/settings/storage", {
      clearSecrets: ["s3Bucket"],
    }));
    expect(unknown.status).toBe(422);
    expect(settings).toEqual(before);

    const conflict = await putStorage(putRequest("http://t/api/v1/settings/storage", {
      s3AccessKey: "replacement",
      clearSecrets: ["s3AccessKey"],
    }));
    expect(conflict.status).toBe(422);
    expect(settings).toEqual(before);
  });

  it("does not expose a PostgreSQL password in database GET or duplicate it into user settings", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://app:env-password@db.internal/synthetix";
    globalDbConfig = {
      dbType: "postgresql",
      pgHost: "db.internal",
      pgPort: 5432,
      pgDatabase: "synthetix",
      pgUser: "app",
      pgPassword: "global-secret",
    };

    try {
      const data = await json(await getDatabase());
      expect(data.connectionUrl).not.toContain("env-password");
      expect(data.pgPassword).toBe("••••cret");
      expect(data.pgPasswordConfigured).toBe(true);

      expect(data.supportedDbTypes).toEqual(["sqlite"]);
      expect(data.mainPostgresSupported).toBe(false);
      expect(data.unsupportedPostgresConfigDetected).toBe(true);

      const response = await putDatabase(putRequest("http://t/api/v1/settings/database", {
        dbType: "postgresql",
        pgHost: "db.internal",
        pgPort: 5432,
        pgDatabase: "synthetix",
        pgUser: "app",
        pgPassword: "new-global-secret",
      }));

      expect(response.status).toBe(409);
      expect(settings.pgPassword).toBeUndefined();
      expect(lastDbWrite).toBeNull();
      expect(globalDbConfig?.pgPassword).toBe("global-secret");
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("rejects PostgreSQL before modifying legacy user or global configuration", async () => {
    settings = { dbType: "postgresql", pgHost: "old-user-host" };
    globalDbConfig = {
      dbType: "postgresql",
      pgHost: "old-host",
      pgPort: 5432,
      pgDatabase: "synthetix",
      pgUser: "app",
      pgPassword: "existing-global-secret",
    };
    const beforeSettings = { ...settings };
    const beforeGlobal = { ...globalDbConfig };

    const response = await putDatabase(putRequest("http://t/api/v1/settings/database", {
      dbType: "postgresql",
      pgHost: "new-host",
      pgPort: 5432,
      pgDatabase: "synthetix",
      pgUser: "app",
      pgPassword: "replacement-secret",
    }));

    expect(response.status).toBe(409);
    expect(settings).toEqual(beforeSettings);
    expect(globalDbConfig).toEqual(beforeGlobal);
    expect(lastDbWrite).toBeNull();
  });

  it("exposes SQLite capability fields without treating RAG PostgreSQL variables as main database selection", async () => {
    const oldHost = process.env.POSTGRES_HOST;
    const oldRagUrl = process.env.LIGHTRAG_PG_DATABASE_URL;
    process.env.POSTGRES_HOST = "rag.internal";
    process.env.LIGHTRAG_PG_DATABASE_URL = "postgresql://rag:secret@rag.internal/rag";
    try {
      const data = await json(await getDatabase());
      expect(data.dbType).toBe("sqlite");
      expect(data.supportedDbTypes).toEqual(["sqlite"]);
      expect(data.mainPostgresSupported).toBe(false);
      expect(data.unsupportedPostgresConfigDetected).toBe(false);
      expect(data.pgHost).toBe("");
    } finally {
      if (oldHost === undefined) delete process.env.POSTGRES_HOST;
      else process.env.POSTGRES_HOST = oldHost;
      if (oldRagUrl === undefined) delete process.env.LIGHTRAG_PG_DATABASE_URL;
      else process.env.LIGHTRAG_PG_DATABASE_URL = oldRagUrl;
    }
  });
});
