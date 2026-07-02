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

  // Extract the top-level section (first segment of headingPath) to decide
  // whether two chunks belong to the same section. Chunks from different
  // top-level sections should NOT be merged, even if both are small — otherwise
  // distinct chapters get glued together and the heading context is lost.
  function topSection(headingPath: string): string {
    return headingPath.split(" > ")[0] || "";
  }

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
    const sameSection = topSection(current.headingPath) === topSection(chunk.headingPath)
      && topSection(current.headingPath) !== "";

    // Only merge if: under token limit AND same top-level section (or both
    // have no section — pre-document preamble). Cross-section merging is
    // forbidden to preserve chapter boundaries.
    if (combinedTokens <= minTokens && sameSection) {
      current.content += "\n\n" + chunk.content;
      current.tokenCount = combinedTokens;
      // Adopt the latest chunk's heading path (deepest known point in the section).
      if (chunk.headingPath) {
        current.headingPath = chunk.headingPath;
        current.h1 = chunk.h1;
        current.h2 = chunk.h2;
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
  // Numbered list items: "1. xxx", "2. xxx", "3、xxx" — Docling emits these as
  // standalone lines, but they are list content, not section titles.
  if (/^\d+[.、)]\s/.test(trimmed)) return false;
  // YAML / config keys: "kind: Deployment", "namespace: operators", "name: redis-shake"
  if (/^[a-zA-Z_][a-zA-Z0-9_.-]*\s*:\s/.test(trimmed)) return false;
  // Shell / CLI commands: "bash setup.sh ...", "docker rm -f ..."
  if (/^(bash|sh|zsh|docker|kubectl|helm|python|python3|node|git|curl|wget|redis-cli|mysql|psql|npm|yarn|pip)\s/i.test(trimmed)) return false;
  // Version tags / container image references: "tag: v2.0.1", "image: 192.168..."
  if (/^(tag|image|version|name|label|env)\s*:\s/i.test(trimmed)) return false;
  // ASCII art / shell operators: "/  Alibaba Cloud  /  *  \ | |"
  if (/^[/\\|]|[/\\|]{2,}|\*{2,}|\|\s*$/.test(trimmed)) return false;
  // IP addresses / host:port: "127.0.0.1:6379", "192.168.191.174:60080"
  if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(trimmed)) return false;
  // Log output / Redis interactive prompts: "2022/03/23 03:43:02 [WARN] ..."
  if (/^\d{4}\/\d{2}\/\d{2}\s/.test(trimmed)) return false;
  if (/^127\.0\.0\.1.*>\s/.test(trimmed)) return false;
  // Lines with special chars typical of code/config: "&gt;", "&lt;", "&amp;"
  if (/(&gt;|&lt;|&amp;)/.test(trimmed)) return false;
  // Lines starting with "+" (concatenated list items / diff output)
  if (/^\+/.test(trimmed)) return false;
  // Redis/shell interactive output patterns: "db0:keys=...", "Keyspace",
  // standalone "kind:", "spec:" etc. These are command output, not titles.
  // Key signal: a real section title is a noun phrase describing a topic.
  // Redis keyspace/db output starts with "db" followed by digits.
  if (/^db\d+[:\s]/i.test(trimmed)) return false;
  // Single English words without spaces (like "Keyspace", "USER") are almost
  // never Chinese document section titles — they're CLI output tokens.
  if (/^[A-Z][a-z]+$/.test(trimmed) && trimmed.length <= 12) return false;
  // All-caps tokens (config keys, Redis commands): "USER", "ENTRYPOINT"
  if (/^[A-Z][A-Z_]+$/.test(trimmed) && trimmed.length <= 15) return false;
  // Lines containing "=" (config assignments): "revisionHistoryLimit: 10"
  if (trimmed.includes("=") && !trimmed.includes(" = ")) return false;
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
  // Redis CLI section markers: "# Keyspace", "# Server", "# Clients", "# Memory"
  // These are INFO command output sections, not document headings.
  if (/^(Keyspace|Server|Clients|Memory|Persistence|Stats|Replication|CPU|Commandstats|Latencystats|Errorstats|Cluster|Modules)$/i.test(t)) return false;
  // Redis/shell CLI comments like "检查db情况", "进入redis-shake" that appear
  // inside command-output regions. These are shell prompt comments, not doc
  // headings. Heuristic: short (≤15 chars), starts with a common CLI verb.
  if (/^(检查|进入|查看|执行|运行|启动|停止|创建|删除|修改|配置|安装|部署)/.test(t) && t.length <= 15) return false;
  return true;
}

export async function splitByMacroAST(markdown: string): Promise<MacroChunk[]> {
  const lines = markdown.split("\n");
  const chunks: MacroChunk[] = [];
  // Full heading stack: index 0 = H1, index 1 = H2, etc.
  let headingStack: string[] = [];
  // Track the markdown level that set stack[0]. If a real H1 (#) set it,
  // subsequent ## headings are sub-sections. If a ## was promoted to root
  // (because no H1 exists), each subsequent ## replaces it as the new root.
  let rootLevel = 0; // 0 = unset, 1 = set by real H1, 2 = set by promoted H2
  let currentLines: string[] = [];
  let i = 0;
  let processedSinceYield = 0;

  function buildHeadingPath(): string {
    return headingStack.filter(Boolean).join(" > ");
  }

  function flush(): void {
    const content = currentLines.join("\n").trim();
    if (!content) {
      currentLines = [];
      return;
    }
    // Skip a chunk that is ONLY a heading line with no body (avoids empty
    // sections where the heading is immediately followed by another heading).
    // BUT: preserve H1/H2 headings even if they're heading-only — a chapter
    // title like "## 10 容器云平台使用规范" that's immediately followed by
    // "### 10.1" still needs its own macro so the headingPath is recorded.
    const hp = buildHeadingPath();
    if (!content.includes("\n")) {
      const mdh = isMarkdownHeading(content);
      if (mdh && mdh.level <= 2) {
        // Keep important chapter headings even without body text.
      } else if (headingStack.includes(content) || mdh) {
        currentLines = [];
        return;
      }
    }
    chunks.push({
      headingPath: hp,
      h1: headingStack[0] || "",
      h2: headingStack[1] || null,
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
        headingPath: buildHeadingPath(),
        h1: headingStack[0] || "",
        h2: headingStack[1] || null,
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
        headingPath: buildHeadingPath(),
        h1: headingStack[0] || "",
        h2: headingStack[1] || null,
        content: tableLines.join("\n"),
        tokenCount: estimateTokens(tableLines.join("\n")),
        isAtomic: true,
      });
      continue;
    }

    // Markdown headings (# ## ### etc.) — ALL levels trigger a section break.
    // Previously only H1/H2 triggered flush; H3+ were swallowed into the parent
    // section, losing the document's true structure. Now every heading level
    // starts a new macro chunk with an updated heading stack.
    const mdHeading = isMarkdownHeading(line);
    if (mdHeading) {
      // Docling emits embedded code (shell/Dockerfile) without ``` fences, so a
      // `# comment` line inside such a block matches the heading regex.
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
      const level = mdHeading.level; // 1-based

      if (level === 1) {
        // Real H1: reset the entire stack, mark root as H1-set.
        headingStack = [mdHeading.text];
        rootLevel = 1;
      } else if (level === 2) {
        // Level 2 headings are the top-level sections in Docling output.
        // Each ## replaces the previous as root IF there's no genuine H1
        // (rootLevel !== 1) OR if the current stack[0] looks like CLI noise
        // that leaked in between markdown headings.
        const stack0IsNoise = headingStack[0] && !headingStack[0].match(/^[\u4e00-\u9fff\d]/);
        if (rootLevel !== 1 || stack0IsNoise) {
          headingStack = [mdHeading.text];
          rootLevel = 2;
        } else {
          // Genuine H1 root exists — this ## is a sub-section.
          headingStack = headingStack.slice(0, 1);
          headingStack[1] = mdHeading.text;
        }
      } else {
        // Sub-section within an existing root (either real H1 or promoted H2).
        headingStack = headingStack.slice(0, level - 1);
        headingStack[level - 1] = mdHeading.text;
        for (let g = 0; g < level - 1; g++) {
          if (!headingStack[g]) headingStack[g] = "";
        }
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
        // Plain-text titles are treated as H2 (sub-section) level.
        if (headingStack.length === 0) {
          headingStack = [trimmed];
          rootLevel = 0; // heuristic, not real markdown
        } else {
          headingStack = headingStack.slice(0, 1);
          headingStack[1] = trimmed;
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
