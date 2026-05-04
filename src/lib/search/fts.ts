import { db } from "@/lib/db";

export async function ensureFtsTable(): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      title, content, content=document_chunks, content_rowid=rowid
    )
  `);
}

export async function searchByKeyword(
  query: string,
  limit = 20,
  offset = 0
): Promise<{ title: string; content: string; snippet: string }[]> {
  await ensureFtsTable();

  await db.$executeRawUnsafe(`INSERT INTO document_fts(document_fts) VALUES('rebuild')`);

  const results = await db.$queryRawUnsafe<
    { title: string; content: string; snippet: string }[]
  >(
    `SELECT title, snippet(document_fts, 1, '<mark>', '</mark>', '...', 40) as snippet, content
     FROM document_fts
     WHERE document_fts MATCH ?
     ORDER BY rank
     LIMIT ? OFFSET ?`,
    query,
    limit,
    offset
  );

  return results;
}
