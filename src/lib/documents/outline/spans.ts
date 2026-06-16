import { estimateTokens } from "@/lib/documents/splitter";

export interface AtomicSpan {
  id: string;
  type: "heading" | "paragraph" | "table" | "code" | "list" | "other";
  text: string;
  tokenCount: number;
  headingLevel?: number;
}

function makeSpan(index: number, text: string, type: AtomicSpan["type"], headingLevel?: number): AtomicSpan {
  return {
    id: `s_${String(index).padStart(4, "0")}`,
    type,
    text,
    tokenCount: estimateTokens(text),
    headingLevel,
  };
}

export function buildAtomicSpans(markdown: string): AtomicSpan[] {
  if (!markdown.trim()) return [];

  const spans: AtomicSpan[] = [];
  const lines = markdown.split("\n");
  let spanIdx = 0;
  let i = 0;

  function isTableLine(line: string): boolean {
    return line.trim().startsWith("|") && line.trim().endsWith("|");
  }

  function isTableSeparator(line: string): boolean {
    return /^\|[\s\-:|]+\|$/.test(line.trim());
  }

  function flushParagraph(lines: string[]): void {
    const text = lines.join("\n").trim();
    if (text) {
      spans.push(makeSpan(spanIdx++, text, "paragraph"));
    }
  }

  let currentParagraph: string[] = [];

  function pushCurrentParagraph(): void {
    if (currentParagraph.length > 0) {
      flushParagraph(currentParagraph);
      currentParagraph = [];
    }
  }

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw;

    // Code blocks
    if (line.trim().startsWith("```")) {
      pushCurrentParagraph();
      const fence = line.trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const content = fence + "\n" + codeLines.join("\n") + "\n" + (i < lines.length ? lines[i - 1].trim() : "```");
      spans.push(makeSpan(spanIdx++, content.trim(), "code"));
      continue;
    }

    // Tables (multi-line)
    if (isTableLine(line)) {
      pushCurrentParagraph();
      const tableLines: string[] = [];
      while (i < lines.length && (isTableLine(lines[i]) || isTableSeparator(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      spans.push(makeSpan(spanIdx++, tableLines.join("\n"), "table"));
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch && !line.trim().startsWith("```")) {
      pushCurrentParagraph();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      spans.push(makeSpan(spanIdx++, text, "heading", level));
      i++;
      continue;
    }

    // Empty line -> paragraph break
    if (line.trim() === "") {
      pushCurrentParagraph();
      i++;
      continue;
    }

    // Regular line -> accumulate paragraph
    currentParagraph.push(line);
    i++;
  }

  pushCurrentParagraph();

  return spans;
}
