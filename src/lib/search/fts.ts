import { db } from "@/lib/db";
import { tokenizeChinese, tokenizeQuery } from "./tokenizer";
import type { SearchResult } from "@/types/documents";

let ftsReady = false;

export async function ensureFtsTable(): Promise<void> {
  if (ftsReady) return;
  // Content table approach: store pre-tokenized text, use default tokenizer (whitespace-split)
  await db.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      title, content, content=document_chunks, content_rowid=rowid
    )
  `);
  ftsReady = true;
}

export async function syncFtsIndex(): Promise<void> {
  await ensureFtsTable();
  await db.$executeRawUnsafe(
    `INSERT INTO document_fts(document_fts) VALUES('rebuild')`
  );
}

export async function searchByKeyword(
  query: string,
  limit = 20,
  offset = 0
): Promise<SearchResult[]> {
  await ensureFtsTable();

  const safeQuery = query.trim();
  if (!safeQuery) return [];

  // Tokenize the query with jieba for Chinese + keep English as-is
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
