import { estimateTokens } from "@/lib/documents/splitter";

export interface MacroChunk {
  headingPath: string;
  h1: string;
  h2: string | null;
  content: string;
  tokenCount: number;
  isAtomic: boolean;
}

export function coalesceMacroChunks(chunks: MacroChunk[], minTokens: number): MacroChunk[] {
  if (chunks.length <= 1) return chunks;

  const merged: MacroChunk[] = [];
  let current: MacroChunk | null = null;

  for (const chunk of chunks) {
    if (chunk.isAtomic) {
      if (current) { merged.push(current); current = null; }
      merged.push(chunk);
      continue;
    }

    if (!current) {
      current = { ...chunk };
      continue;
    }

    const combinedTokens = current.tokenCount + chunk.tokenCount;
    if (combinedTokens <= minTokens) {
      current.content += "\n\n" + chunk.content;
      current.tokenCount = combinedTokens;
      if (chunk.h2) {
        current.h2 = chunk.h2;
        current.headingPath = [current.h1, current.h2].filter(Boolean).join(" > ");
      }
    } else {
      merged.push(current);
      current = { ...chunk };
    }
  }

  if (current) merged.push(current);
  return merged;
}

function isPlainTextTitle(line: string, prevEmpty: boolean, nextEmpty: boolean): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.length < 4 || trimmed.length > 80) return false;
  if (trimmed.startsWith("![") || trimmed.startsWith("|") || trimmed.startsWith("```")) return false;
  if (trimmed.startsWith("#")) return false; // already handled
  // Not ending with Chinese/English sentence punctuation
  if (/[。！？.!?，,；;：:）\)》>、]$/.test(trimmed)) return false;
  // Must be bracketed by empty lines (at least one side)
  if (!prevEmpty && !nextEmpty) return false;
  return true;
}

function isMarkdownHeading(line: string): { level: number; text: string } | null {
  const match = line.match(/^(#{1,6})\s+(.+)/);
  if (match) return { level: match[1].length, text: match[2].trim() };
  return null;
}

export function splitByMacroAST(markdown: string): MacroChunk[] {
  const lines = markdown.split("\n");
  const chunks: MacroChunk[] = [];
  let currentH1 = "";
  let currentH2: string | null = null;
  let currentLines: string[] = [];
  let i = 0;

  function flush(): void {
    const content = currentLines.join("\n").trim();
    if (!content) {
      currentLines = [];
      return;
    }
    const headingParts = [currentH1];
    if (currentH2) headingParts.push(currentH2);
    const headingPath = headingParts.filter(Boolean).join(" > ") || "";
    chunks.push({
      headingPath,
      h1: currentH1,
      h2: currentH2,
      content,
      tokenCount: estimateTokens(content),
      isAtomic: false,
    });
    currentLines = [];
  }

  function isEmpty(line: string): boolean {
    return line.trim() === "";
  }

  function isTableLine(line: string): boolean {
    return line.trim().startsWith("|") && line.trim().endsWith("|");
  }

  function isTableSeparator(line: string): boolean {
    return /^\|[\s\-:|]+\|$/.test(line.trim());
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks: collect as atomic
    if (line.trim().startsWith("```")) {
      flush();
      const fence = line.trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const content = fence + "\n" + codeLines.join("\n") + "\n```";
      chunks.push({
        headingPath: [currentH1, currentH2].filter(Boolean).join(" > ") || "",
        h1: currentH1,
        h2: currentH2,
        content,
        tokenCount: estimateTokens(content),
        isAtomic: true,
      });
      continue;
    }

    // Tables: collect as atomic
    if (isTableLine(line)) {
      flush();
      const tableLines: string[] = [];
      while (i < lines.length && (isTableLine(lines[i]) || isTableSeparator(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      chunks.push({
        headingPath: [currentH1, currentH2].filter(Boolean).join(" > ") || "",
        h1: currentH1,
        h2: currentH2,
        content: tableLines.join("\n"),
        tokenCount: estimateTokens(tableLines.join("\n")),
        isAtomic: true,
      });
      continue;
    }

    // Markdown headings (# ##)
    const mdHeading = isMarkdownHeading(line);
    if (mdHeading) {
      flush();
      if (mdHeading.level === 1) {
        currentH1 = mdHeading.text;
        currentH2 = null;
      } else {
        if (!currentH1) currentH1 = mdHeading.text;
        currentH2 = mdHeading.text;
      }
      i++;
      continue;
    }

    // Plain-text title detection (for DOCX without markdown headings)
    const prevEmpty = i === 0 || isEmpty(lines[i - 1] || "");
    const nextEmpty = i + 1 < lines.length && isEmpty(lines[i + 1]);

    if (isPlainTextTitle(line, prevEmpty, nextEmpty)) {
      const trimmed = line.trim();
      // Verify there's content ahead (not just another heading)
      let hasContentAhead = false;
      let j = i + 1;
      while (j < lines.length && !hasContentAhead) {
        const nl = lines[j].trim();
        if (!nl || nl.startsWith("![")) { j++; continue; }
        // Skip if it looks like another heading
        if (!isPlainTextTitle(lines[j], isEmpty(lines[j - 1] || ""), j + 1 < lines.length && isEmpty(lines[j + 1]))) {
          hasContentAhead = nl.length >= 8;
        }
        j++;
      }
      if (hasContentAhead) {
        flush();
        if (!currentH1) {
          currentH1 = trimmed;
        } else {
          currentH2 = trimmed;
        }
        i++;
        continue;
      }
    }

    // Regular line: accumulate
    currentLines.push(line);
    i++;
  }

  flush();

  return chunks;
}
