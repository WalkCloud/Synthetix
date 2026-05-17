import { db } from "@/lib/db";
import { tokenizeChinese, tokenizeQuery } from "./tokenizer";
import type { SearchResult } from "@/types/documents";

let ftsReady = false;
let ftsIndexed = false;

export async function ensureFtsTable(): Promise<void> {
  if (ftsReady) return;
  const existing = await db.$queryRawUnsafe<{ sql: string }[]>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='document_fts'`
  );
  if (existing.length > 0 && existing[0].sql?.includes("content=document_chunks")) {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS document_fts`);
  }
  await db.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      title, content
    )
  `);
  ftsReady = true;
}

async function ensureFtsIndexed(): Promise<void> {
  if (ftsIndexed) return;
  const count = await db.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*) as c FROM document_fts`
  );
  if (count[0]?.c > 0) {
    ftsIndexed = true;
    return;
  }
  const chunkCount = await db.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*) as c FROM document_chunks`
  );
  if (chunkCount[0]?.c > 0) {
    await syncFtsIndex();
  }
  ftsIndexed = true;
}

export async function syncFtsIndex(): Promise<void> {
  await ensureFtsTable();
  const chunks = await db.$queryRawUnsafe<
    { rowid: number; title: string; content: string }[]
  >(`SELECT rowid, title, content FROM document_chunks`);
  await db.$executeRawUnsafe(`DELETE FROM document_fts`);
  if (chunks.length === 0) return;
  await db.$executeRawUnsafe(`INSERT INTO document_fts(rowid, title, content) VALUES ${chunks.map(() => '(?, ?, ?)').join(',')}`,
    ...chunks.flatMap((chunk) => [
      chunk.rowid,
      chunk.title ? tokenizeChinese(chunk.title) : "",
      chunk.content ? tokenizeChinese(chunk.content) : "",
    ])
  );
  ftsIndexed = true;
}

export async function syncFtsIndexForDocument(docId: string): Promise<void> {
  await ensureFtsTable();

  const rowIds = await db.$queryRawUnsafe<{ rowid: number }[]>(
    `SELECT rowid FROM document_chunks WHERE document_id = ?`,
    docId,
  );

  if (rowIds.length > 0) {
    const placeholders = rowIds.map(() => "?").join(",");
    await db.$executeRawUnsafe(
      `DELETE FROM document_fts WHERE rowid IN (${placeholders})`,
      ...rowIds.map((r) => r.rowid),
    );
  }

  const chunks = await db.$queryRawUnsafe<
    { rowid: number; title: string; content: string }[]
  >(
    `SELECT rowid, title, content FROM document_chunks WHERE document_id = ?`,
    docId,
  );

  if (chunks.length === 0) return;

  await db.$executeRawUnsafe(
    `INSERT INTO document_fts(rowid, title, content) VALUES ${chunks.map(() => "(?, ?, ?)").join(",")}`,
    ...chunks.flatMap((chunk) => [
      chunk.rowid,
      chunk.title ? tokenizeChinese(chunk.title) : "",
      chunk.content ? tokenizeChinese(chunk.content) : "",
    ]),
  );

  ftsIndexed = true;
}

export async function searchByKeyword(
  query: string,
  limit = 20,
  offset = 0
): Promise<SearchResult[]> {
  await ensureFtsTable();
  await ensureFtsIndexed();

  const safeQuery = query.trim();
  if (!safeQuery) return [];

  const tokenized = tokenizeQuery(safeQuery);
  if (!tokenized) return [];

  const rows = await db.$queryRawUnsafe<
    { rowid: number; rank: number; snippet: string; chunk_id: string; document_id: string; title: string; document_name: string }[]
  >(
    `SELECT f.rowid, f.rank,
            snippet(document_fts, 1, '<mark>', '</mark>', '...', 40) as snippet,
            dc.id as chunk_id, dc.document_id, dc.title, d.original_name as document_name
     FROM document_fts f
     JOIN document_chunks dc ON dc.rowid = f.rowid
     JOIN documents d ON d.id = dc.document_id
     WHERE document_fts MATCH ?
     ORDER BY f.rank
     LIMIT ? OFFSET ?`,
    tokenized,
    limit,
    offset
  );

  if (rows.length === 0) return [];

  const minRank = Math.min(...rows.map((r) => r.rank));
  const maxRank = Math.max(...rows.map((r) => r.rank));
  const rankRange = maxRank - minRank || 1;

  return rows.map((r) => {
    const score = 1 - (r.rank - minRank) / rankRange;
    return {
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentName: r.document_name,
      title: r.title,
      content: r.snippet,
      score: Math.round(score * 100) / 100,
    };
  });
}
