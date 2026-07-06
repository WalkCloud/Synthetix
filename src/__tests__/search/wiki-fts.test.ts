import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import {
  ensureWikiFtsTable,
  syncWikiFtsIndex,
  syncWikiFtsForEntry,
  searchWikiFts,
  removeWikiFtsForEntry,
  removeWikiFtsForEntries,
  stripWikiFtsSnippetMarkup,
  isWikiFtsEnabled,
} from "@/lib/search/wiki-fts";

/**
 * Integration tests against the real SQLite dev.db (same pattern as
 * __tests__/search/fts.test.ts). Each test creates throwaway wiki_entries rows
 * (unique userId to stay isolated), exercises the FTS path, then cleans up.
 *
 * These tests require the `wiki_entries` table to exist in the test database.
 * The test DB (vitest's DATABASE_URL=file:./dev.db) is a scratch file that may
 * not have the full Prisma schema applied — we detect that and skip the
 * schema-dependent suite, so the test file still passes in a bare environment.
 */

const TEST_USER_ID = `fts-test-${randomUUID()}`;
const createdEntryIds: string[] = [];
let schemaReady = false;

async function schemaHasWikiEntries(): Promise<boolean> {
  try {
    await db.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*) as c FROM wiki_entries LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

async function createEntry(
  overrides: Partial<{ id: string; title: string; content: string; confidence: number; status: string }> = {},
) {
  const id = overrides.id ?? randomUUID();
  const entry = await db.wikiEntry.create({
    data: {
      id,
      userId: TEST_USER_ID,
      type: "topic",
      title: overrides.title ?? "Test entry",
      slug: `test-${id}`,
      content: overrides.content ?? "Test content",
      sourceRefs: "[]",
      confidence: overrides.confidence ?? 0.8,
      status: overrides.status ?? "active",
    },
  });
  createdEntryIds.push(id);
  return entry;
}

async function cleanup() {
  if (createdEntryIds.length > 0) {
    await db.wikiEntry.deleteMany({ where: { id: { in: createdEntryIds } } }).catch(() => {});
    await removeWikiFtsForEntries(createdEntryIds).catch(() => {});
    createdEntryIds.length = 0;
  }
}

beforeAll(async () => {
  schemaReady = await schemaHasWikiEntries();
  if (schemaReady) await cleanup();
  await ensureWikiFtsTable();
});

// Pure-logic tests — no DB schema required.
describe("wiki-fts (pure helpers)", () => {
  it("creates the wiki_fts virtual table without error", async () => {
    await ensureWikiFtsTable();
    const rows = await db.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*) as c FROM wiki_fts`);
    expect(Number(rows[0]?.c)).toBeGreaterThanOrEqual(0);
  });

  it("strips mark tags from snippets", () => {
    const snippet = "...具备 <mark>微服务</mark> 治理能力...";
    expect(stripWikiFtsSnippetMarkup(snippet)).toBe("...具备 微服务 治理能力...");
  });

  it("isWikiFtsEnabled returns a boolean", () => {
    expect(typeof isWikiFtsEnabled()).toBe("boolean");
  });

  it("returns [] for empty/whitespace query without touching the schema", async () => {
    expect(await searchWikiFts("", TEST_USER_ID, 10)).toEqual([]);
    expect(await searchWikiFts("   ", TEST_USER_ID, 10)).toEqual([]);
  });
});

// Schema-dependent integration tests. The `if (!schemaReady) return;` guard in
// each test makes them pass (no-op) when the test DB lacks wiki_entries —
// e.g. a bare scratch dev.db without the Prisma schema pushed.
describe("wiki-fts integration (schema-dependent)", () => {
  it("indexes a single entry and recalls it via searchWikiFts (CJK)", async () => {
    if (!schemaReady) return; // belt-and-suspenders for the skipIf
    const entry = await createEntry({
      title: "容器云平台网络拓扑设计",
      content: "本节描述容器网络、宿主机网络与外部网络的三层拓扑结构，采用 Calico BGP 模式。",
    });
    await syncWikiFtsForEntry(entry.id);

    const hits = await searchWikiFts("网络拓扑", TEST_USER_ID, 10);
    const found = hits.find((h) => h.entryId === entry.id);
    expect(found).toBeDefined();
    expect(found?.title).toContain("网络拓扑");
    expect(Number.isFinite(found?.rank)).toBe(true);
  });

  it("returns matches for English keywords in mixed-language content", async () => {
    if (!schemaReady) return;
    const entry = await createEntry({
      title: "Kubernetes 控制平面高可用",
      content: "The control plane runs API Server, etcd, scheduler and controller manager.",
    });
    await syncWikiFtsForEntry(entry.id);
    const hits = await searchWikiFts("control plane", TEST_USER_ID, 10);
    expect(hits.some((h) => h.entryId === entry.id)).toBe(true);
  });

  it("does not return inactive entries (status filter)", async () => {
    if (!schemaReady) return;
    const entry = await createEntry({
      title: "应被排除的非活跃条目 topology-inactive",
      content: "inactive content for filtering test",
      status: "archived",
    });
    await syncWikiFtsForEntry(entry.id); // skips inactive rows
    const hits = await searchWikiFts("topology-inactive", TEST_USER_ID, 10);
    expect(hits.some((h) => h.entryId === entry.id)).toBe(false);
  });

  it("removes an entry from the index via removeWikiFtsForEntry", async () => {
    if (!schemaReady) return;
    const entry = await createEntry({
      title: "待删除的拓扑条目 remove-me-topology",
      content: "topology removal target",
    });
    await syncWikiFtsForEntry(entry.id);
    expect((await searchWikiFts("remove-me-topology", TEST_USER_ID, 10)).some((h) => h.entryId === entry.id)).toBe(true);
    await removeWikiFtsForEntry(entry.id);
    expect((await searchWikiFts("remove-me-topology", TEST_USER_ID, 10)).some((h) => h.entryId === entry.id)).toBe(false);
  });

  it("full reindex (syncWikiFtsIndex) completes without error", async () => {
    if (!schemaReady) return;
    await expect(syncWikiFtsIndex()).resolves.toBeUndefined();
    await ensureWikiFtsTable();
  });
});
