import type { OutlineSection } from "@/lib/outline-tree";

/**
 * Parse a part-level markdown outline into an OutlineSection tree.
 *
 * The assistant emits one markdown block per part (chapter/section/subsection
 * headings). Heading depth (## / ### / #### / ##### ...) maps directly to tree
 * depth, so the outline's granularity is whatever the model decided each part
 * needs — simple parts stay shallow, complex parts go deep. This is the
 * adaptive-depth replacement for the old fixed-TARGET_DEPTH recursion.
 *
 * Recognised per-heading metadata lines (optional, after a heading):
 *   keyPoints: a；b；c        (or 要点:, or comma/semicolon separated)
 *   - bullet item             (markdown list items also feed keyPoints)
 *   字数: 500  / words: 500   (estimatedWords)
 */

const HEADING_RE = /^(#{2,6})\s+(.+?)\s*$/;
const KEYPOINTS_LINE_RE = /^(?:keyPoints|keypoints|要点|写作要点)\s*[:：]\s*(.+)$/i;
const WORDS_RE = /^(?:字数|words|estimatedWords|预估字数)\s*[:：]\s*(\d[\d,]*)\s*$/i;
const LIST_ITEM_RE = /^\s*[-*•·]\s+(.+)$/;

function stripLeadingNumber(title: string): string {
  // Strip leading numbering the model may include ("1.1", "第3章", "第三章", "1、")
  return title
    .replace(/^第[一二三四五六七八九十百零\d]+[章节部分篇]\s*/, "")
    .replace(/^[\d]+([.．][\d]+)*[、\s:：]?\s*/, "")
    .trim();
}

function splitKeyPoints(raw: string): string[] {
  return raw
    .split(/[；;。\n]|，|,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseMarkdownToSections(md: string): OutlineSection[] {
  const lines = md.split(/\r?\n/);
  const roots: OutlineSection[] = [];
  // Stack of {depth, node}; depth = heading '#' count. ## = 2 is the first
  // level under a part (chapters); ### = 3 sections; and so on.
  const stack: { depth: number; node: OutlineSection }[] = [];
  let lastNode: OutlineSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(HEADING_RE);
    if (heading) {
      const depth = heading[1].length;
      const title = stripLeadingNumber(heading[2]);
      if (!title) continue;
      const node: OutlineSection = { num: "", title, children: [] };
      // Pop until we reach the parent (a heading with fewer '#' than this one).
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      if (stack.length === 0) {
        roots.push(node);
      } else {
        const parent = stack[stack.length - 1].node;
        parent.children = parent.children || [];
        parent.children.push(node);
      }
      stack.push({ depth, node });
      lastNode = node;
      continue;
    }

    if (!lastNode) continue;

    const kpLine = line.match(KEYPOINTS_LINE_RE);
    if (kpLine) {
      const pts = splitKeyPoints(kpLine[1]);
      if (pts.length) lastNode.keyPoints = (lastNode.keyPoints || []).concat(pts);
      continue;
    }

    const wordsLine = line.match(WORDS_RE);
    if (wordsLine) {
      const n = Number.parseInt(wordsLine[1].replace(/,/g, ""), 10);
      if (Number.isFinite(n) && n > 0) lastNode.estimatedWords = n;
      continue;
    }

    const listItem = line.match(LIST_ITEM_RE);
    if (listItem) {
      lastNode.keyPoints = (lastNode.keyPoints || []).concat(listItem[1].trim());
      continue;
    }
    // Ignore prose / other lines.
  }

  return roots;
}
