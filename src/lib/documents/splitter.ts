export interface SplitChunk {
  index: number;
  title: string;
  content: string;
  tokenCount: number;
  headingPath: string;
}

export interface SplitOptions {
  maxTokens: number;
  minTokens?: number;
  overlapTokens?: number;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1.5));
}

export function splitMarkdown(
  markdown: string,
  options: SplitOptions
): SplitChunk[] {
  const maxTokens = options.maxTokens;
  const totalTokens = estimateTokens(markdown);

  if (totalTokens <= maxTokens) {
    const title = extractTitle(markdown);
    return [{ index: 0, title, content: markdown, tokenCount: totalTokens, headingPath: title }];
  }

  // Step 1: Try markdown headings (# prefix)
  const sections = splitByHeadings(markdown);
  if (sections.length > 1) {
    return assembleChunks(sections, maxTokens, options.minTokens || 256, options.overlapTokens);
  }

  // Step 2: Extract plain-text section titles from document structure
  const titles = extractSectionTitles(markdown);

  // Step 3: If clear section structure found, split by titles
  if (titles.length >= 3) {
    return splitByTitles(markdown, titles, maxTokens);
  }

  // Step 4: No structure — fall back to line-based splitting and flag for LLM review
  return splitByLines(markdown, maxTokens, options.minTokens || 256);
}

// ── Section title extraction (plain text headings) ──

export function extractSectionTitles(markdown: string): string[] {
  const lines = markdown.split("\n");
  const titles: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Skip images, tables, separators
    if (trimmed.startsWith("![") || trimmed.includes("|") || /^-{3,}$/.test(trimmed)) continue;

    // Markdown heading already handled
    if (/^#{1,6}\s/.test(trimmed)) {
      titles.push(trimmed.replace(/^#+\s*/, ""));
      continue;
    }

    // CJK numbered sections.
    if (/^[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[\u3001\uff0c,]\s*/.test(trimmed)) { titles.push(trimmed); continue; }
    if (/^\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\d]+[\u7ae0\u8282]/.test(trimmed)) { titles.push(trimmed); continue; }
    if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(trimmed)) { titles.push(trimmed); continue; }

    // Numbered sections: "1.", "1.1", "1.1.1", "(1)", "1)", "A.", "a)"
    if (/^(\d+\.)+\s/.test(trimmed) && trimmed.length <= 80) { titles.push(trimmed); continue; }
    if (/^[A-Z]\.\s/.test(trimmed) && trimmed.length <= 60) { titles.push(trimmed); continue; }

    // Short title-like line (5-50 chars), bracketed by empty lines, not ending with punctuation
    const prevEmpty = i === 0 || !lines[i - 1].trim();
    const nextEmpty = i >= lines.length - 1 || !lines[i + 1]?.trim();
    const noEndPunct = !/[。！？.!?，,；;：:）\)》>]$/.test(trimmed);

    if (prevEmpty && nextEmpty && noEndPunct && trimmed.length >= 5 && trimmed.length <= 50) {
      // Verify: next non-empty line has substantial content (longer than title)
      let nextContentLen = 0;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nl = lines[j].trim();
        if (nl && !nl.startsWith("![")) { nextContentLen = nl.length; break; }
      }
      if (nextContentLen > trimmed.length * 1.5) {
        titles.push(trimmed);
      }
    }
  }

  return titles;
}

// ── Split by extracted section titles ──

function splitByTitles(
  markdown: string,
  titles: string[],
  maxTokens: number,
): SplitChunk[] {
  // Split the document at title positions
  const sections: { title: string; content: string }[] = [];
  let remaining = markdown;

  for (const title of titles) {
    const idx = remaining.indexOf(title);
    if (idx === -1) continue;

    // Content before this title (from previous section)
    const before = remaining.slice(0, idx).trim();
    if (sections.length > 0 && before) {
      sections[sections.length - 1].content += "\n\n" + before;
    } else if (sections.length === 0 && before) {
      // Preamble content before first title
      sections.push({ title: "Preface", content: before });
    }

    sections.push({ title, content: "" });
    remaining = remaining.slice(idx + title.length);
  }

  // Remaining content goes to last section
  if (remaining.trim() && sections.length > 0) {
    sections[sections.length - 1].content += "\n\n" + remaining.trim();
  }

  // Assemble chunks from sections, respecting maxTokens
  const chunks: SplitChunk[] = [];
  let currentContent = "";
  let currentTokens = 0;
  let currentTitle = "";

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.title + "\n" + section.content);

    if (currentTokens + sectionTokens > maxTokens && currentTokens > 0) {
      chunks.push({
        index: chunks.length,
        title: currentTitle || section.title,
        content: currentContent.trim(),
        tokenCount: currentTokens,
        headingPath: currentTitle,
      });
      currentContent = "";
      currentTokens = 0;
      currentTitle = section.title;
    }

    if (!currentTitle) currentTitle = section.title;

    currentContent += (currentContent ? "\n\n" : "") + section.title + "\n" + section.content;
    currentTokens += sectionTokens;

    // Section alone exceeds maxTokens: split by lines
    if (sectionTokens > maxTokens && !currentContent.includes("\n\n")) {
      const sub = splitByLines(section.title + "\n" + section.content, maxTokens, 256);
      if (currentContent.trim()) {
        chunks.push({
          index: chunks.length,
          title: currentTitle,
          content: currentContent.trim(),
          tokenCount: currentTokens,
          headingPath: currentTitle,
        });
      }
      for (const s of sub) {
        s.headingPath = section.title;
        s.index = chunks.length;
        chunks.push(s);
      }
      currentContent = "";
      currentTokens = 0;
      currentTitle = "";
    }
  }

  if (currentContent.trim()) {
    chunks.push({
      index: chunks.length,
      title: currentTitle || currentContent.slice(0, 60),
      content: currentContent.trim(),
      tokenCount: currentTokens,
      headingPath: currentTitle,
    });
  }

  return chunks.length > 0 ? chunks : splitByLines(markdown, maxTokens, 256);
}

// ── Line-by-line fallback ──

function splitByLines(
  markdown: string,
  maxTokens: number,
  minTokens: number,
): SplitChunk[] {
  const lines = markdown.split("\n");
  const chunks: SplitChunk[] = [];
  let currentLines: string[] = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);

    if (lineTokens > maxTokens) {
      if (currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        chunks.push({
          index: chunks.length,
          title: content.slice(0, 60),
          content,
          tokenCount: currentTokens,
          headingPath: "",
        });
        currentLines = [];
        currentTokens = 0;
      }
      const subChunks = splitByCharacters(line, maxTokens);
      for (const sub of subChunks) {
        sub.index = chunks.length;
        chunks.push(sub);
      }
      continue;
    }

    if (currentTokens + lineTokens > maxTokens && currentTokens >= minTokens) {
      const content = currentLines.join("\n").trim();
      chunks.push({
        index: chunks.length,
        title: content.slice(0, 60),
        content,
        tokenCount: currentTokens,
        headingPath: "",
      });
      currentLines = [];
      currentTokens = 0;
    }

    currentLines.push(line);
    currentTokens += lineTokens;
  }

  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    chunks.push({
      index: chunks.length,
      title: content.slice(0, 60),
      content,
      tokenCount: currentTokens,
      headingPath: "",
    });
  }

  if (chunks.length === 0) {
    chunks.push({
      index: 0,
      title: extractTitle(markdown),
      content: markdown,
      tokenCount: estimateTokens(markdown),
      headingPath: "",
    });
  }

  return chunks;
}

// ── Character-based last resort ──

function splitByCharacters(text: string, maxTokens: number): SplitChunk[] {
  const chunks: SplitChunk[] = [];
  const maxChars = maxTokens * 2;
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + maxChars, text.length);
    if (end < text.length) {
      const slice = text.slice(offset, end);
      const sentenceBreak = slice.lastIndexOf("。");
      const dotBreak = slice.lastIndexOf(".");
      const bestBreak = Math.max(
        sentenceBreak > 0 ? offset + sentenceBreak + 1 : -1,
        dotBreak > 0 ? offset + dotBreak + 1 : -1,
      );
      if (bestBreak > offset + maxChars * 0.5) end = bestBreak;
    }
    const content = text.slice(offset, end).trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        title: content.slice(0, 60).replace(/\n/g, " "),
        content,
        tokenCount: estimateTokens(content),
        headingPath: "",
      });
    }
    offset = end;
  }

  return chunks;
}

// ── Heading-based splitting ──

interface Section {
  level: number;
  heading: string;
  content: string;
}

function splitByHeadings(markdown: string): Section[] {
  const sections: Section[] = [];
  const lines = markdown.split("\n");
  let currentHeading = "";
  let currentLevel = 0;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match && currentLines.length === 0) {
      currentLevel = match[1].length;
      currentHeading = match[2];
    } else if (match) {
      sections.push({
        level: currentLevel,
        heading: currentHeading,
        content: currentLines.join("\n"),
      });
      currentLevel = match[1].length;
      currentHeading = match[2];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length) {
    sections.push({ level: currentLevel, heading: currentHeading, content: currentLines.join("\n") });
  }

  if (sections.length === 0) {
    sections.push({ level: 0, heading: "", content: markdown });
  }

  return sections;
}

function assembleChunks(
  sections: Section[],
  maxTokens: number,
  minTokens: number,
  overlapTokens: number = 0,
): SplitChunk[] {
  const chunks: SplitChunk[] = [];
  let currentChunk = "";
  let currentTokens = 0;
  let headingStack: string[] = [];
  let overlapPrefix = "";

  function flushChunk(content: string, tokens: number, hStack: string[]): string {
    chunks.push(buildChunkFromHeadingStack(chunks.length, content, tokens, hStack));
    if (overlapTokens > 0) {
      const chars = Math.floor(overlapTokens * 1.5);
      return content.length > chars ? content.slice(-chars) : content;
    }
    return "";
  }

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content);

    if (sectionTokens > maxTokens) {
      if (currentChunk.trim()) {
        overlapPrefix = flushChunk(currentChunk.trim(), currentTokens, headingStack);
        currentChunk = "";
        currentTokens = 0;
      }
      const subSections = splitByLines(section.content, maxTokens, minTokens);
      for (let si = 0; si < subSections.length; si++) {
        const sub = subSections[si];
        const content = si === 0 && overlapPrefix ? overlapPrefix + "\n\n" + sub.content : sub.content;
        const tokens = estimateTokens(content);
        chunks.push({
          ...sub,
          index: chunks.length,
          headingPath: section.heading || sub.title,
          title: section.heading || sub.title,
          content,
          tokenCount: tokens,
        });
        if (overlapTokens > 0) {
          const chars = Math.floor(overlapTokens * 1.5);
          overlapPrefix = content.length > chars ? content.slice(-chars) : content;
        }
      }
      if (section.heading) {
        headingStack = updateHeadingStack(headingStack, section.level, section.heading);
      }
      continue;
    }

    if (currentTokens + sectionTokens > maxTokens && currentTokens >= minTokens) {
      overlapPrefix = flushChunk(currentChunk.trim(), currentTokens, headingStack);
      currentChunk = overlapPrefix ? overlapPrefix + "\n\n" : "";
      currentTokens = estimateTokens(currentChunk);
    }

    if (section.heading) {
      headingStack = updateHeadingStack(headingStack, section.level, section.heading);
    }

    currentChunk += section.content + "\n\n";
    currentTokens += sectionTokens;
  }

  if (currentChunk.trim()) {
    chunks.push(buildChunkFromHeadingStack(chunks.length, currentChunk.trim(), currentTokens, headingStack));
  }

  return chunks;
}

function buildChunkFromHeadingStack(
  index: number,
  content: string,
  tokenCount: number,
  headingStack: string[],
): SplitChunk {
  const chunkTitle = headingStack.length > 0
    ? headingStack[headingStack.length - 1]
    : extractTitle(content);
  return { index, title: chunkTitle, content, tokenCount, headingPath: headingStack.join(" > ") };
}

function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match) return match[1];
  const firstLine = markdown.trim().split("\n")[0];
  return firstLine ? firstLine.slice(0, 80) : "Untitled";
}

function updateHeadingStack(stack: string[], level: number, heading: string): string[] {
  const newStack = stack.slice(0, level - 1);
  newStack.push(heading);
  return newStack;
}
