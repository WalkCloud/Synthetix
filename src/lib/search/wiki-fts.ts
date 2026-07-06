import { db } from "@/lib/db";
import { tokenizeChinese, tokenizeQuery } from "./tokenizer";

/**
 * FTS5 full-text index over {@link WikiEntry}, mirroring the runtime-created
 * `document_fts` pattern in {@link ./fts.ts}.
 *
 * Differences from `document_fts`:
 *  - `wiki_entries.id` is a UUID string (not an integer rowid), so the FTS
 *    table stores `entry_id` in a column and we JOIN on it rather than on rowid.
 *  - The index is keyed per user implicitly via the JOIN to `wiki_entries`
 *    (which carries `user_id` + `status`).
 *
 * As with `document_fts`, the table is created at runtime (not via a Prisma
 * migration) and lazily self-heals on first search after a server restart.
 */

let wikiFtsReady = false;
let wikiFtsIndexed = false;
let wikiFtsBackgroundReindexing = false;

/** Master switch. Set WIKI_FTS_ENABLED=off to fall back to the legacy LIKE path. */
const WIKI_FTS_ENABLED = process.env.WIKI_FTS_ENABLED !== "off";

export function isWikiFtsEnabled(): boolean {
  return WIKI_FTS_ENABLED;
}

export function stripWikiFtsSnippetMarkup(value: string): string {
  return value.replace(/<\/?mark>/g, "");
}

/** Idempotently create the `wiki_fts` virtual table. */
export async function ensureWikiFtsTable(): Promise<void> {
  if (!WIKI_FTS_ENABLED) return;
  if (wikiFtsReady) return;
  await db.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
      entry_id UNINDEXED,
      title,
      content
    )
  `);
  wikiFtsReady = true;
}

/**
 * Lazily ensure the index is populated. On a fresh server start the in-process
 * `wikiFtsIndexed` flag is false even though the table may already hold rows
 * from a prior run; if so, we just flip the flag. If the table is empty but
 * wiki_entries has rows, kick a non-blocking background rebuild so the first
 * search returns fast (with whatever partial rows are present).
 */
export async function ensureWikiFtsIndexed(): Promise<void> {
  if (!WIKI_FTS_ENABLED) return;
  if (wikiFtsIndexed) return;
  await ensureWikiFtsTable();

  const count = await db.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*) as c FROM wiki_fts`,
  );
  if (count[0]?.c > 0) {
    wikiFtsIndexed = true;
    return;
  }

  const entryCount = await db.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*) as c FROM wiki_entries WHERE status='active'`,
  );
  if (entryCount[0]?.c > 0) {
    if (wikiFtsBackgroundReindexing) return;
    wikiFtsBackgroundReindexing = true;
    void syncWikiFtsIndex()
      .catch((err) => {
        console.error("[wiki-fts] background reindex failed:", err);
      })
      .finally(() => {
        wikiFtsBackgroundReindexing = false;
      });
  }
  wikiFtsIndexed = true;
}

/**
 * Full rebuild: drop all rows, re-insert every active wiki entry with
 * jieba-pre-tokenized title/content (so FTS5's default whitespace tokenizer
 * handles CJK correctly).
 */
export async function syncWikiFtsIndex(): Promise<void> {
  if (!WIKI_FTS_ENABLED) return;
  await ensureWikiFtsTable();

  const entries = await db.$queryRawUnsafe<
    { id: string; title: string; content: string }[]
  >(`SELECT id, title, content FROM wiki_entries WHERE status='active'`);

  await db.$executeRawUnsafe(`DELETE FROM wiki_fts`);
  if (entries.length === 0) {
    wikiFtsIndexed = true;
    return;
  }

  const BATCH_SIZE = 100; // 100 rows × 3 vars = 300, well under SQLite's 999 limit
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await db.$executeRawUnsafe(
      `INSERT INTO wiki_fts(entry_id, title, content) VALUES ${batch.map(() => "(?, ?, ?)").join(",")}`,
      ...batch.flatMap((e) => [
        e.id,
        e.title ? tokenizeChinese(e.title) : "",
        e.content ? tokenizeChinese(e.content) : "",
      ]),
    );
    // Yield between batches so a multi-thousand-entry reindex doesn't hold the
    // Next.js event loop while jieba tokenises each row.
    if (i + BATCH_SIZE < entries.length) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  wikiFtsIndexed = true;
}

/**
 * Idempotent upsert for a single entry: delete its existing row(s) then insert
 * fresh. Call this from wiki write paths (create/update) so the index stays in
 * sync incrementally without a full rebuild.
 */
export async function syncWikiFtsForEntry(entryId: string): Promise<void> {
  if (!WIKI_FTS_ENABLED) return;
  await ensureWikiFtsTable();
  const rows = await db.$queryRawUnsafe<{ title: string; content: string; status: string }[]>(
    `SELECT title, content, status FROM wiki_entries WHERE id = ?`,
    entryId,
  );
  // Always remove the old row first (covers update + status->non-active cases).
  await db.$executeRawUnsafe(`DELETE FROM wiki_fts WHERE entry_id = ?`, entryId);
  const row = rows[0];
  // Re-insert only if the entry is active. Inactive entries must not be
  // searchable, so their FTS row stays deleted.
  if (row && row.status === "active") {
    await db.$executeRawUnsafe(
      `INSERT INTO wiki_fts(entry_id, title, content) VALUES (?, ?, ?)`,
      entryId,
      row.title ? tokenizeChinese(row.title) : "",
      row.content ? tokenizeChinese(row.content) : "",
    );
  }
}

/** Remove a single entry from the index. Call on delete. */
export async function removeWikiFtsForEntry(entryId: string): Promise<void> {
  if (!WIKI_FTS_ENABLED) return;
  await ensureWikiFtsTable();
  await db.$executeRawUnsafe(`DELETE FROM wiki_fts WHERE entry_id = ?`, entryId);
}

/** Remove a batch of entries from the index. Call on bulk delete. */
export async function removeWikiFtsForEntries(entryIds: string[]): Promise<void> {
  if (!WIKI_FTS_ENABLED || entryIds.length === 0) return;
  await ensureWikiFtsTable();
  // Bind each id as a separate ? to avoid SQL-injection via string interp.
  const placeholders = entryIds.map(() => "?").join(",");
  await db.$executeRawUnsafe(
    `DELETE FROM wiki_fts WHERE entry_id IN (${placeholders})`,
    ...entryIds,
  );
}

export interface WikiFtsHit {
  entryId: string;
  title: string;
  content: string;
  confidence: number;
  /** FTS5 rank (lower = more relevant; BM25-style). 0 when FTS didn't match. */
  rank: number;
  /** Highlighted content snippet with <mark>...</mark>, empty if no snippet. */
  snippet: string;
}

/**
 * Run an FTS5 MATCH query against `wiki_fts`, joined back to `wiki_entries` to
 * enforce user_id + status='active' and to pull confidence/content.
 *
 * The MATCH expression is built by {@link tokenizeQuery} (jieba search-mode
 * tokenisation → quoted-phrase OR / sliding-window AND-phrase OR). Returns
 * best-first by FTS rank. Returns `[]` if the query is empty or FTS is disabled.
 */
export async function searchWikiFts(
  query: string,
  userId: string,
  limit = 20,
): Promise<WikiFtsHit[]> {
  if (!WIKI_FTS_ENABLED) return [];
  const match = tokenizeQuery(query);
  if (!match) return [];

  await ensureWikiFtsIndexed();
  // If the background rebuild hasn't populated anything yet, FTS returns [] —
  // callers fall back to the legacy LIKE / trigram path. That's the intended
  // fail-soft behaviour during cold start.
  try {
    const rows = await db.$queryRawUnsafe<
      {
        entry_id: string;
        title: string;
        content: string;
        confidence: number;
        rank: number;
        snippet: string | null;
      }[]
    >(
      `SELECT w.entry_id AS entry_id,
              we.title AS title,
              we.content AS content,
              we.confidence AS confidence,
              w.rank AS rank,
              snippet(wiki_fts, 2, '<mark>', '</mark>', '...', 40) AS snippet
         FROM wiki_fts w
         JOIN wiki_entries we ON we.id = w.entry_id
        WHERE wiki_fts MATCH ?
          AND we.user_id = ?
          AND we.status = 'active'
        ORDER BY w.rank
        LIMIT ?`,
      match,
      userId,
      limit,
    );
    return rows.map((r) => ({
      entryId: r.entry_id,
      title: r.title,
      content: r.content,
      confidence: r.confidence,
      rank: r.rank,
      snippet: r.snippet ?? "",
    }));
  } catch (err) {
    // FTS should never block wiki search. A malformed MATCH expression, a
    // not-yet-ready table, or a SQLite build without FTS5 all land here.
    console.warn("[wiki-fts] MATCH query failed (non-blocking):", err);
    return [];
  }
}
