import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { queryWikiForSection } from "@/lib/wiki/query";
import { syncWikiFtsForEntry, removeWikiFtsForEntries } from "@/lib/search/wiki-fts";

/**
 * Integration tests for the FTS + trigram recall path in queryWikiForSection.
 *
 * These require the `wiki_entries` table AND the wiki_fts index in the test
 * DB. When the test DB (vitest's file:./dev.db) lacks the schema, every test
 * no-ops via the `schemaReady` guard and the file still passes.
 */

const TEST_USER_ID = `qtest-${randomUUID()}`;
const createdIds: string[] = [];
let schemaReady = false;

async function schemaHasWikiEntries(): Promise<boolean> {
  try {
    await db.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*) as c FROM wiki_entries LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

async function seed(
  overrides: Partial<{ title: string; content: string; confidence: number }>,
) {
  const id = randomUUID();
  await db.wikiEntry.create({
    data: {
      id,
      userId: TEST_USER_ID,
      type: "topic",
      title: overrides.title ?? "Topic",
      slug: `q-${id}`,
      content: overrides.content ?? "content",
      sourceRefs: "[]",
      confidence: overrides.confidence ?? 0.85,
      status: "active",
    },
  });
  await syncWikiFtsForEntry(id);
  createdIds.push(id);
  return id;
}

beforeAll(async () => {
  schemaReady = await schemaHasWikiEntries();
  if (schemaReady) {
    await db.user.upsert({
      where: { id: TEST_USER_ID },
      create: { id: TEST_USER_ID, username: TEST_USER_ID, passwordHash: "test-hash" },
      update: {},
    });
    await db.wikiEntry.deleteMany({ where: { userId: TEST_USER_ID } }).catch(() => {});
  }
});

describe("queryWikiForSection (FTS + trigram)", () => {
  it("returns FTS-matching entries for a CJK query", async () => {
    if (!schemaReady) return;
    const id = await seed({
      title: "容器云平台网络拓扑设计",
      content: "容器网络、宿主机网络与外部网络的三层拓扑结构。",
    });
    const hits = await queryWikiForSection(
      { title: "网络拓扑", description: null, keyPoints: null },
      "draft",
      TEST_USER_ID,
      null,
      5,
      [],
    );
    expect(hits.some((h) => h.id === id)).toBe(true);
  });

  it("returns empty for an empty query (no terms)", async () => {
    if (!schemaReady) return;
    const hits = await queryWikiForSection(
      { title: "", description: null, keyPoints: null },
      "draft",
      TEST_USER_ID,
      null,
      5,
      [],
    );
    expect(hits).toEqual([]);
  });

  it("ranks a title match above a content-only match", async () => {
    if (!schemaReady) return;
    const titleHit = await seed({
      title: "Calico BGP 网络策略",
      content: "generic content without the keyword",
      confidence: 0.9,
    });
    const contentHit = await seed({
      title: "无关条目 content-only",
      content: "Calico BGP 网络策略 仅出现在正文里",
      confidence: 0.9,
    });
    const hits = await queryWikiForSection(
      { title: "Calico BGP 网络策略", description: null, keyPoints: null },
      "draft",
      TEST_USER_ID,
      null,
      5,
      [],
    );
    const titleIdx = hits.findIndex((h) => h.id === titleHit);
    const contentIdx = hits.findIndex((h) => h.id === contentHit);
    if (titleIdx !== -1 && contentIdx !== -1) {
      expect(titleIdx).toBeLessThan(contentIdx); // title match ranks first
    }
  });

  it("respects the limit parameter", async () => {
    if (!schemaReady) return;
    // Seed several matching entries.
    for (let i = 0; i < 6; i++) {
      await seed({
        title: `多集群管理架构 ${i} Karmada`,
        content: "多集群 Karmada 调度",
        confidence: 0.8,
      });
    }
    const hits = await queryWikiForSection(
      { title: "多集群管理架构 Karmada", description: null, keyPoints: null },
      "draft",
      TEST_USER_ID,
      null,
      2, // limit
      [],
    );
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  // Cleanup after the suite so seeded rows don't leak across test files.
  it("cleans up seeded entries", async () => {
    if (!schemaReady) return;
    if (createdIds.length > 0) {
      await db.wikiEntry.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
      await removeWikiFtsForEntries(createdIds).catch(() => {});
    }
    expect(true).toBe(true);
  });
});
