import { splitByLinesInternal } from "@/lib/documents/pipeline";
import type { SplitChunk } from "@/lib/documents/splitter";
import { estimateTokens } from "@/lib/documents/splitter";
import { makeChunkTitle } from "@/lib/documents/outline/micro-split";

function forceTruncateToTokenLimit(content: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * 1.5);
  if (content.length <= maxChars) return content;
  const truncated = content.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf("\n");
  return lastNewline > maxChars * 0.5 ? truncated.slice(0, lastNewline) : truncated;
}

// A markdown table row: a leading pipe, content, trailing pipe.
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
// The header separator row: | --- | :---: | --- |
const TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/;

/**
 * Split a markdown-table-dominated chunk into header-preserving fragments.
 *
 * Splitting a markdown table mid-table yields fragments of bare data rows with
 * no column names — meaningless for retrieval and downstream generation. This
 * repeats the header + separator row at the top of every fragment so each is a
 * valid, self-describing table.
 *
 * Returns null when the content isn't dominated by a single contiguous table
 * (mixed prose+table, too few rows, or a single row wider than the budget) so
 * the caller falls back to generic line splitting. A leading non-table prefix
 * (e.g. the injected `[heading > path]` breadcrumb) rides on the first fragment;
 * any trailing non-table lines ride on the last.
 */
function splitMarkdownTableByRows(
  content: string,
  maxTokens: number,
): { content: string; tokenCount: number }[] | null {
  const lines = content.split("\n");

  // Skip a possible non-table prefix (breadcrumb / intro) up to the table.
  let prefixEnd = 0;
  while (prefixEnd < lines.length && !TABLE_ROW_RE.test(lines[prefixEnd])) prefixEnd++;
  const prefixLines = lines.slice(0, prefixEnd);

  // Collect the contiguous run of table rows.
  let tableEnd = prefixEnd;
  while (tableEnd < lines.length && TABLE_ROW_RE.test(lines[tableEnd])) tableEnd++;
  const tableLines = lines.slice(prefixEnd, tableEnd);
  const suffixLines = lines.slice(tableEnd);

  // Only split when the table is well-formed and dominates the chunk; otherwise
  // generic line splitting stays more faithful to mixed prose+table content.
  if (tableLines.length < 4) return null;
  if (estimateTokens(tableLines.join("\n")) < estimateTokens(content) * 0.6) return null;

  const header = tableLines[0];
  const hasSep = tableLines.length > 1 && TABLE_SEP_RE.test(tableLines[1]);
  const headerBlock = hasSep ? `${header}\n${tableLines[1]}` : header;
  const dataRows = hasSep ? tableLines.slice(2) : tableLines.slice(1);
  if (dataRows.length === 0) return null;

  const prefixText = prefixLines.join("\n").replace(/\n+$/, "");
  const suffixText = suffixLines.join("\n").trim();
  const prefixTokens = prefixText ? estimateTokens(prefixText + "\n\n") : 0;
  const suffixTokens = suffixText ? estimateTokens("\n\n" + suffixText) : 0;
  const headerTokens = estimateTokens(headerBlock + "\n");

  // If a single data row already overflows the budget, this strategy can't help.
  if (headerTokens + prefixTokens + estimateTokens(dataRows[0] + "\n") > maxTokens) return null;

  const capacity = maxTokens - headerTokens - prefixTokens - suffixTokens;
  if (capacity <= 0) return null;

  // Greedily pack rows into fragments that each fit the per-fragment budget.
  const groups: string[][] = [];
  let cur: string[] = [];
  let curTokens = 0;
  for (const row of dataRows) {
    const rt = estimateTokens(row + "\n");
    if (curTokens + rt > capacity && cur.length > 0) {
      groups.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(row);
    curTokens += rt;
  }
  if (cur.length > 0) groups.push(cur);
  if (groups.length <= 1) return null;

  return groups.map((rows, i) => {
    const parts: string[] = [];
    if (i === 0 && prefixText) parts.push(prefixText);
    parts.push(headerBlock, ...rows);
    if (i === groups.length - 1 && suffixText) parts.push("", suffixText);
    const body = parts.join("\n");
    return { content: body, tokenCount: estimateTokens(body) };
  });
}

export async function enforceEmbeddingSafeChunks(
  chunks: SplitChunk[],
  maxTokens: number,
): Promise<SplitChunk[]> {
  const safeChunks: SplitChunk[] = [];
  let processed = 0;

  for (const chunk of chunks) {
    // Measure with the conservative estimator (len/1.5) instead of trusting the
    // incoming tokenCount. Micro-split packs segments using len/2, which under-
    // estimates CJK-heavy content — chunks that are actually over the embedding
    // limit were slipping through this guard carrying a low tokenCount. The guard
    // must be authoritative about the bytes it will send to the embedding API.
    const measuredTokens = estimateTokens(chunk.content);
    if (measuredTokens <= maxTokens) {
      safeChunks.push({ ...chunk, tokenCount: measuredTokens });
    } else {
      // Oversized: prefer header-preserving table-row split for table-dominated
      // chunks; otherwise fall back to generic line splitting.
      const tableParts = splitMarkdownTableByRows(chunk.content, maxTokens);
      const subChunks = tableParts ?? splitByLinesInternal(chunk.content, maxTokens, chunk.title);

      if (subChunks.length <= 1) {
        const truncated = forceTruncateToTokenLimit(chunk.content, maxTokens);
        safeChunks.push({
          ...chunk,
          content: truncated,
          tokenCount: estimateTokens(truncated),
        });
      } else {
        for (let i = 0; i < subChunks.length; i++) {
          const baseTitle = chunk.headingPath || chunk.title || "Untitled";
          safeChunks.push({
            index: safeChunks.length,
            title: makeChunkTitle(`${baseTitle} (part ${i + 1}/${subChunks.length})`, subChunks[i].content),
            content: subChunks[i].content,
            tokenCount: subChunks[i].tokenCount,
            headingPath: chunk.headingPath,
          });
        }
      }
    }

    // Yield to the event loop every ~32 chunks; the per-chunk splitting above
    // can do nontrivial work on oversized content.
    if (++processed % 32 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return safeChunks;
}
