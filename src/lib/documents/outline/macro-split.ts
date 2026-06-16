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
  // Figure / table captions ("图 1.2-7", "表 3", "Figure 2", "Table 4") are body
  // content, not section titles.
  if (/^(图|表)\s*[\d一二三四五六七八九十]/.test(trimmed)) return false;
  if (/^(Figure|Fig\.?|Table|Tab\.?)\s*\d/i.test(trimmed)) return false;
  // Bold-marked body lines ("**自定义容器内部命令检测**") are emphasis, not titles.
  if (/\*\*.+?\*\*/.test(trimmed)) return false;
  // Markdown list items ("- item", "* item", "• item") are body content.
  if (/^[-*•]\s/.test(trimmed)) return false;
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

// Heuristic: does this line look like a line of code (shell / Dockerfile / config)?
// Docling HTML-escapes embedded code (&& → &amp;&amp;, > → &gt;, < → &lt;), so the
// patterns cover both the raw and the escaped forms.
const CODE_LINE_RE = /^(FROM|RUN|COPY|ADD|CMD|ENTRYPOINT|ENV|ARG|WORKDIR|USER|EXPOSE|VOLUME|LABEL|HEALTHCHECK|MAINTAINER|ONBUILD)\s/i;
const CODE_CMD_RE = /^(tar|yum|dnf|apt|apt-get|brew|cd|cp|mv|rm|mkdir|rmdir|chmod|chown|chgrp|ln|touch|echo|export|unset|cat|tee|head|tail|wc|sort|uniq|wget|curl|pip|pip3|npm|pnpm|yarn|systemctl|service|kubectl|docker|podman|make|gcc|g\+\+|clang|cmake|java|javac|python|python3|node|git|svn|unzip|gzip|gunzip|bzip2|xz|sed|awk|grep|find|sudo|nohup|exec|source|sh|bash|zsh)\b/;
const CODE_PKG_RE = /\.(rpm|tar|gz|tgz|bz2|xz|zip|deb|conf|cfg|yml|yaml|sh|bash|service|ini|env|properties|war|jar|whl)\b/;

function looksLikeCodeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (CODE_LINE_RE.test(t)) return true; // Dockerfile / Makefile instructions
  if (/(&&|&amp;&amp;|\|\||&gt;|&lt;|`)/.test(t)) return true; // shell operators / backticks
  if (/\\\s*$/.test(t)) return true; // line continuation
  if (CODE_CMD_RE.test(t)) return true; // common shell commands
  if (/^(\.\/|\.\.\/)/.test(t)) return true; // relative executable path
  if (CODE_PKG_RE.test(t)) return true; // package / config file extension
  if (/^[A-Z_][A-Z0-9_]*\s*[:?+]?=/.test(t)) return true; // VAR= assignment
  if (/(\$\(.*\)|\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*)/.test(t)) return true; // shell expansion
  return false;
}

// A `#`/`##` line is a code comment (not a real heading) when it sits inside an
// unfenced code block — i.e. there is code immediately above AND below it. A
// genuine section heading starts a section, so it has prose (or nothing / a
// prior heading) above it, never code on both sides. Requiring code on BOTH
// sides keeps real headings intact even when they are immediately followed by
// a code block.
function isEmbeddedInCode(lines: string[], i: number): boolean {
  let aboveCode = 0;
  let belowCode = 0;
  for (let j = Math.max(0, i - 3); j < i; j++) {
    const t = lines[j].trim();
    if (t && looksLikeCodeLine(t)) aboveCode++;
  }
  for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
    const t = lines[j].trim();
    if (t && looksLikeCodeLine(t)) belowCode++;
  }
  return aboveCode >= 1 && belowCode >= 1;
}

// Docling also emits non-heading body text as `# ...` lines: shell notes
// ("注意：…本步骤。"), command explanations ("WORKDIR指令便于…，以简化脚本"),
// and code flags ("-e 若指令传回值…", "--chown选项…"). These are full sentences
// or start with a code token. A genuine section heading is a short noun phrase
// with no CJK sentence punctuation and no code-token prefix, so anything else
// is demoted to body content. (ASCII ","/"." are intentionally NOT rejected —
// legitimate titles like "安装haproxy keepalived(二进制安装,麒麟V10)" use them.)
function isLikelyRealHeading(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[，。：；！？]/.test(t)) return false; // a full sentence, not a heading
  if (/^-{1,2}[A-Za-z]/.test(t)) return false; // "-e …", "--chown…" code flag
  if (CODE_LINE_RE.test(t)) return false; // "COPY …", "WORKDIR …" (no leading #)
  return true;
}

export async function splitByMacroAST(markdown: string): Promise<MacroChunk[]> {
  const lines = markdown.split("\n");
  const chunks: MacroChunk[] = [];
  let currentH1 = "";
  let currentH2: string | null = null;
  let currentLines: string[] = [];
  let i = 0;
  let processedSinceYield = 0;

  function flush(): void {
    const content = currentLines.join("\n").trim();
    if (!content) {
      currentLines = [];
      return;
    }
    if (!content.includes("\n") && (content === currentH1 || content === currentH2 || isMarkdownHeading(content))) {
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
      if (mdHeading.level > 2) {
        currentLines.push(line);
        i++;
        continue;
      }
      // Docling emits embedded code (shell/Dockerfile) without ``` fences, so a
      // `# comment` line inside such a block matches the heading regex. Without
      // this guard, lines like `# 编译安装` hijack currentH1 and mis-group every
      // following chunk under a bogus code-comment "topic". Treat them as content.
      if (isEmbeddedInCode(lines, i)) {
        currentLines.push(line);
        i++;
        continue;
      }
      // Docling also mis-emits whole sentences, notes, and code flags as `#`
      // headings (e.g. "# 注意：…本步骤。", "# -e 若指令传回值…"). A real heading
      // is a short noun phrase; demote sentence/code-flag "headings" to content.
      if (!isLikelyRealHeading(mdHeading.text)) {
        currentLines.push(line);
        i++;
        continue;
      }
      flush();
      if (mdHeading.level === 1) {
        currentH1 = mdHeading.text;
        currentH2 = null;
      } else {
        if (!currentH1) currentH1 = mdHeading.text;
        currentH2 = mdHeading.text;
      }
      currentLines.push(line);
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
        currentLines.push(line);
        i++;
        continue;
      }
    }

    // Regular line: accumulate
    currentLines.push(line);
    i++;

    // Yield to the event loop every ~256 lines so a huge markdown
    // doesn't hold the Next.js process for tens of ms in one tick.
    if (++processedSinceYield >= 256) {
      processedSinceYield = 0;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  flush();

  return chunks;
}
