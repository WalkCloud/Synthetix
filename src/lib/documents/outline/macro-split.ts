import { estimateTokens } from "@/lib/documents/splitter";

export interface MacroChunk {
  headingPath: string;
  h1: string;
  h2: string | null;
  content: string;
  tokenCount: number;
  isAtomic: boolean;
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
    const headingPath = headingParts.join(" > ");
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
      if (i < lines.length) i++; // closing fence
      const content = fence + "\n" + codeLines.join("\n") + "\n```";
      chunks.push({
        headingPath: [currentH1, currentH2].filter(Boolean).join(" > ") || "Code",
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
        headingPath: [currentH1, currentH2].filter(Boolean).join(" > ") || "Table",
        h1: currentH1,
        h2: currentH2,
        content: tableLines.join("\n"),
        tokenCount: estimateTokens(tableLines.join("\n")),
        isAtomic: true,
      });
      continue;
    }

    // Headings
    const h1Match = line.match(/^#\s+(.+)/);
    const h2Match = line.match(/^##\s+(.+)/);
    const h3Match = line.match(/^###\s+(.+)/);

    if (h1Match && !h2Match) {
      flush();
      currentH1 = h1Match[1].trim();
      currentH2 = null;
      i++;
      continue;
    }

    if (h2Match) {
      flush();
      if (!currentH1) currentH1 = h2Match[1].trim();
      currentH2 = h2Match[1].trim();
      i++;
      continue;
    }

    // H3+: attach to current H2 section
    if (h3Match) {
      currentLines.push(line);
      i++;
      continue;
    }

    currentLines.push(line);
    i++;
  }

  flush();

  return chunks;
}
