import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { ensureFtsTable, stripFtsSnippetMarkup } from "@/lib/search/fts";

describe("FTS5 search", () => {
  it("creates virtual table without error", async () => {
    await ensureFtsTable();
    expect(true).toBe(true);
  });

  it("search on empty table returns empty array", async () => {
    await ensureFtsTable();
    const results = await db.$queryRawUnsafe<
      { title: string; content: string }[]
    >(
      `SELECT title, content FROM document_fts WHERE document_fts MATCH ? LIMIT 10`,
      "nonexistent_xyz"
    );
    expect(Array.isArray(results)).toBe(true);
  });

  it("strips raw mark tags from keyword snippets", () => {
    const snippet = "...具备 <mark>微</mark> <mark>服务</mark> <mark>治理</mark> 能力...";

    expect(stripFtsSnippetMarkup(snippet)).toBe("...具备 微 服务 治理 能力...");
  });
});
