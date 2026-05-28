"use client";

import { createElement, Fragment, type ReactNode } from "react";

type Token = { type: "text"; value: string } | { type: "tag"; value: string };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineToTokens(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });
    const raw = m[0];
    if (raw.startsWith("***")) {
      tokens.push({ type: "tag", value: `<strong><em>${m[2]}</em></strong>` });
    } else if (raw.startsWith("**")) {
      tokens.push({ type: "tag", value: `<strong>${m[3]}</strong>` });
    } else if (raw.startsWith("*") && !raw.startsWith("**")) {
      tokens.push({ type: "tag", value: `<em>${m[4]}</em>` });
    } else if (raw.startsWith("`")) {
      tokens.push({ type: "tag", value: `<code>${m[5]}</code>` });
    }
    last = m.index + raw.length;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return tokens;
}

function renderInline(text: string): ReactNode[] {
  const tokens = inlineToTokens(text);
  return tokens.map((t, i) => {
    if (t.type === "text") return <Fragment key={i}>{t.value}</Fragment>;
    return <span key={i} dangerouslySetInnerHTML={{ __html: t.value }} />;
  });
}

interface Block {
  type: "p" | "h" | "ul" | "ol" | "blockquote" | "hr" | "table" | "code";
  level?: number;
  lines: string[];
}

function parseBlocks(text: string): Block[] {
  const rawLines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (trimmed === "") { i++; continue; }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: "hr", lines: [] });
      i++; continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: "h", level: headingMatch[1].length, lines: [headingMatch[2]] });
      i++; continue;
    }

    if (trimmed.startsWith("> ")) {
      const lines: string[] = [];
      while (i < rawLines.length && rawLines[i].trim().startsWith("> ")) {
        lines.push(rawLines[i].trim().replace(/^>\s*/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines });
      continue;
    }

    if (trimmed.startsWith("```")) {
      const lines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trim().startsWith("```")) {
        lines.push(rawLines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", lines });
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+/);
    if (ulMatch) {
      const lines: string[] = [];
      while (i < rawLines.length && rawLines[i].trim().match(/^[-*+]\s+/)) {
        lines.push(rawLines[i].trim().replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", lines });
      continue;
    }

    const olMatch = trimmed.match(/^\d+[.)]\s+/);
    if (olMatch) {
      const lines: string[] = [];
      while (i < rawLines.length && rawLines[i].trim().match(/^\d+[.)]\s+/)) {
        lines.push(rawLines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", lines });
      continue;
    }

    const isTableRow = (l: string) => /^\|(.+)\|$/.test(l.trim());
    const isSeparator = (l: string) => /^\|[\s\-:]+\|$/.test(l.trim());
    if (isTableRow(trimmed)) {
      const rows: string[] = [];
      while (i < rawLines.length && (isTableRow(rawLines[i]) || isSeparator(rawLines[i]))) {
        if (!isSeparator(rawLines[i])) rows.push(rawLines[i].trim());
        i++;
      }
      blocks.push({ type: "table", lines: rows });
      continue;
    }

    const lines: string[] = [trimmed];
    i++;
    while (i < rawLines.length && rawLines[i].trim() !== "" && !rawLines[i].trim().match(/^#{1,4}\s/) && !rawLines[i].trim().match(/^[-*+]\s/) && !rawLines[i].trim().match(/^\d+[.)]\s/) && !rawLines[i].trim().startsWith("> ") && !rawLines[i].trim().startsWith("```") && !isTableRow(rawLines[i])) {
      lines.push(rawLines[i].trim());
      i++;
    }
    blocks.push({ type: "p", lines });
  }

  return blocks;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "hr":
      return <hr key={key} className="my-4 border-border" />;

    case "h":
      const Tag = `h${Math.min(block.level ?? 2, 4)}` as "h2" | "h3" | "h4";
      const headingSizes: Record<string, string> = {
        h2: "text-lg font-bold text-foreground mt-6 mb-3",
        h3: "text-base font-semibold text-foreground/75 mt-5 mb-2",
        h4: "text-sm font-semibold text-muted-foreground mt-4 mb-2",
      };
      return <Tag key={key} className={headingSizes[Tag]}>{renderInline(block.lines[0])}</Tag>;

    case "p":
      return (
        <p key={key} className="mb-3 text-[15px] leading-[1.85] text-foreground/75" style={{ textIndent: "2em" }}>
          {renderInline(block.lines.join(""))}
        </p>
      );

    case "ul":
      return (
        <ul key={key} className="my-2 ml-6 list-disc space-y-1 text-[15px] leading-[1.85] text-foreground/75">
          {block.lines.map((line, j) => (
            <li key={j}>{renderInline(line)}</li>
          ))}
        </ul>
      );

    case "ol":
      return (
        <ol key={key} className="my-2 ml-6 list-decimal space-y-1 text-[15px] leading-[1.85] text-foreground/75">
          {block.lines.map((line, j) => (
            <li key={j}>{renderInline(line)}</li>
          ))}
        </ol>
      );

    case "blockquote":
      return (
        <blockquote key={key} className="my-3 pl-4 border-l-3 border-border text-muted-foreground italic">
          {block.lines.map((line, j) => (
            <p key={j} className="mb-1" style={{ textIndent: "2em" }}>{renderInline(line)}</p>
          ))}
        </blockquote>
      );

    case "code":
      return (
        <pre key={key} className="my-3 p-4 bg-slate-800 text-slate-100 rounded-lg text-sm overflow-x-auto">
          <code>{block.lines.join("\n")}</code>
        </pre>
      );

    case "table":
      const parseRow = (row: string) =>
        row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = parseRow(block.lines[0]);
      const body = block.lines.slice(1).map(parseRow);
      return (
        <div key={key} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-secondary">
                {header.map((cell, j) => (
                  <th key={j} className="border border-border px-3 py-2 text-left font-semibold text-foreground/75">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, j) => (
                <tr key={j} className="even:bg-muted/30">
                  {row.map((cell, k) => (
                    <td key={k} className="border border-border px-3 py-2 text-foreground/75">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownBlock({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const blocks = parseBlocks(trimmed);
  return <>{blocks.map((block, i) => renderBlock(block, i))}</>;
}
