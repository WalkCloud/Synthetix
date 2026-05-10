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
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}

export function splitMarkdown(
  markdown: string,
  options: SplitOptions
): SplitChunk[] {
  const maxTokens = options.maxTokens;
  const minTokens = options.minTokens || 256;
  const totalTokens = estimateTokens(markdown);

  if (totalTokens <= maxTokens) {
    const title = extractTitle(markdown);
    return [
      {
        index: 0,
        title,
        content: markdown,
        tokenCount: totalTokens,
        headingPath: title,
      },
    ];
  }

  const sections = splitByHeadings(markdown);
  const chunks: SplitChunk[] = [];
  let currentChunk = "";
  let currentTokens = 0;
  let headingStack: string[] = [];

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content);

    if (currentTokens + sectionTokens > maxTokens && currentTokens >= minTokens) {
      const chunkTitle = headingStack.length > 0
        ? headingStack[headingStack.length - 1]
        : extractTitle(currentChunk);
      chunks.push({
        index: chunks.length,
        title: chunkTitle,
        content: currentChunk.trim(),
        tokenCount: currentTokens,
        headingPath: headingStack.join(" > "),
      });
      currentChunk = "";
      currentTokens = 0;
    }

    if (section.heading) {
      headingStack = updateHeadingStack(headingStack, section.level, section.heading);
    }

    currentChunk += section.content + "\n\n";
    currentTokens += sectionTokens;
  }

  if (currentChunk.trim()) {
    const chunkTitle = headingStack.length > 0
      ? headingStack[headingStack.length - 1]
      : extractTitle(currentChunk);
    chunks.push({
      index: chunks.length,
      title: chunkTitle,
      content: currentChunk.trim(),
      tokenCount: currentTokens,
      headingPath: headingStack.join(" > "),
    });
  }

  if (chunks.length === 0) {
    const title = extractTitle(markdown);
    chunks.push({ index: 0, title, content: markdown, tokenCount: totalTokens, headingPath: title });
  }

  return chunks;
}

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

function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1] : "Untitled";
}

function updateHeadingStack(stack: string[], level: number, heading: string): string[] {
  const newStack = stack.slice(0, level - 1);
  newStack.push(heading);
  return newStack;
}
