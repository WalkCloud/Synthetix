/**
 * Structure-based document chunking — uses Docling's structure.json sections
 * list as the authoritative heading source.
 *
 * The sections list (314 entries for a typical large document) is clean: every
 * entry is a genuine section header with a precise `level` (2=chapter, 3=section,
 * 4=subsection, etc.), and CLI output / ASCII art / Redis commands that pollute
 * markdown `#` headings are completely absent. This eliminates the entire class
 * of heuristic problems that plagued the markdown-based macro-split approach.
 *
 * Algorithm:
 *   1. From sections, extract level-2 chapter titles and locate them in the
 *      markdown by text offset (sequential cursor search).
 *   2. Slice the markdown at chapter boundaries → MacroChunk[] with headingPath
 *      taken directly from the section title (no guessing).
 *   3. For chapters that exceed chunkMaxTokens, further split using level-3+
 *      subsection titles found within that chapter's range.
 *   4. Content before the first chapter (cover page, TOC) is dropped.
 *
 * The resulting MacroChunk[] feeds into the existing micro-split / pack /
 * breadcrumb / guard pipeline unchanged.
 */
import { estimateTokens } from "@/lib/documents/splitter";
import type { MacroChunk } from "@/lib/documents/outline/macro-split";
import type { StructureJson, StructureSection } from "@/lib/documents/atoms";

/** Minimum token count for a chunk to be worth keeping as standalone. */
const MIN_CHUNK_TOKENS = 100;

/**
 * Infer heading level from the section text's numbering prefix.
 * "1 产品背景" → 2 (chapter), "2.1 Container Platform" → 3, "2.1.1 基础" → 4.
 * Unnumbered text → 3 (treated as sub-section, not chapter, so cover pages
 * and document titles don't become chapter boundaries).
 */
function inferLevelFromText(text: string): number {
  const match = text.trim().match(/^(\d+(?:\.\d+)*)\s/);
  if (!match) return 3; // No numbering — treat as sub-section level
  const dotCount = match[1].split(".").length;
  return Math.min(dotCount + 1, 6); // "1" → 2, "2.1" → 3, "2.1.1" → 4
}

/**
 * Locate section titles in the markdown text and return their character offsets.
 * Uses a sequential cursor so repeated titles don't match the wrong instance.
 *
 * @returns Array of { offset, title, level } in document order. Only includes
 *          sections that were successfully located.
 */
function locateSectionsInMarkdown(
  markdown: string,
  sections: StructureSection[],
): Array<{ offset: number; title: string; level: number }> {
  const located: Array<{ offset: number; title: string; level: number }> = [];
  let cursor = 0;

  for (const sec of sections) {
    const text = sec.text?.trim();
    if (!text || sec.level == null) continue;

    // Try matching as a markdown heading. Docling's level number doesn't always
    // match the # count in markdown: PDF docs often have all sections at level=1
    // but exported as ## in markdown. So we try multiple prefix lengths.
    let pos = -1;
    for (const hashCount of [sec.level, 2, 1, 3, 4, 5, 6]) {
      const hashes = "#".repeat(Math.min(hashCount, 6));
      const headingPattern = `${hashes} ${text}`;
      pos = markdown.indexOf(headingPattern, cursor);
      if (pos >= 0) break;
    }

    // Fallback: try plain text match (section title might not have # prefix).
    if (pos < 0) {
      pos = markdown.indexOf(text, cursor);
    }

    if (pos >= 0) {
      located.push({ offset: pos, title: text, level: sec.level });
      cursor = pos + text.length;
    }
  }

  return located;
}

/**
 * Build the heading path for a subsection by finding its parent chapter.
 * Returns the chapter title (level-2 section) that contains the given offset.
 */
function findChapterForOffset(
  located: Array<{ offset: number; title: string; level: number }>,
  offset: number,
): string | null {
  let chapter: string | null = null;
  for (const loc of located) {
    if (loc.offset > offset) break;
    if (loc.level <= 2) chapter = loc.title;
  }
  return chapter;
}

/**
 * Hard-split an over-large text block into line-bounded macros, each under
 * `chunkMaxTokens`. Used as a SAFETY NET before the block reaches the ONNX
 * semantic chunker (`microSplitByLocalSemantic`), which computes sentence
 * embeddings for every sentence in a macro and can exhaust memory / time on
 * dense inputs above ~10K tokens (observed: a 29K-token book chapter with no
 * usable sub-headings crashed `local_chunk.py` with SIGKILL/OOM).
 *
 * All output macros inherit the same headingPath/h1 so downstream pack/breadcrumb
 * still group them under the original section.
 */
function splitByLines(
  content: string,
  headingPath: string,
  h1: string,
  chunkMaxTokens: number,
): MacroChunk[] {
  const lines = content.split("\n");
  const macros: MacroChunk[] = [];
  let currentLines: string[] = [];
  let currentTokens = 0;
  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (currentTokens + lineTokens > chunkMaxTokens && currentLines.length > 0) {
      const blockContent = currentLines.join("\n");
      macros.push({
        headingPath,
        h1,
        h2: null,
        content: blockContent,
        tokenCount: currentTokens,
        isAtomic: false,
      });
      currentLines = [];
      currentTokens = 0;
    }
    currentLines.push(line);
    currentTokens += lineTokens;
  }
  if (currentLines.length > 0) {
    const blockContent = currentLines.join("\n");
    macros.push({
      headingPath,
      h1,
      h2: null,
      content: blockContent,
      tokenCount: currentTokens,
      isAtomic: false,
    });
  }
  return macros;
}

/**
 * Split a markdown document into MacroChunks using Docling's structure.json
 * sections list as the authoritative heading source.
 *
 * @param markdown Full markdown text from Docling
 * @param structure Parsed structure.json
 * @param chunkMaxTokens Maximum tokens per chunk (from embedding model context)
 * @returns MacroChunk[] with clean headingPaths from Docling sections
 */
export function splitByStructure(
  markdown: string,
  structure: StructureJson,
  chunkMaxTokens: number,
): MacroChunk[] {
  const sections = structure.sections ?? [];
  if (sections.length === 0) return [];

  // Normalize section levels: when all sections share the same level (common
  // in PDF Docling output where everything is level=1), infer the true hierarchy
  // from the numbering prefix in the text (e.g. "1 产品背景" → level 2,
  // "2.1 Container Platform" → level 3, "2.1.1 基础平台" → level 4).
  const rawLevels = sections.map((s) => s.level ?? 99);
  const allSameLevel = rawLevels.every((l) => l === rawLevels[0]);

  const normalizedSections: StructureSection[] = allSameLevel
    ? sections.map((s) => ({
        ...s,
        level: inferLevelFromText(s.text ?? ""),
      }))
    : sections;

  // Locate all sections in the markdown.
  const located = locateSectionsInMarkdown(markdown, normalizedSections);
  if (located.length === 0) return [];

  // Find chapter boundaries (level ≤ 2), skipping non-content sections
  // (cover pages, dates, table of contents).
  let chapterBoundaries = located.filter((l) => {
    if (l.level > 2) return false;
    const t = l.title.toLowerCase().trim();
    if (/^(table of contents|目录|目次|contents)$/.test(t)) return false;
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(l.title.trim())) return false;
    return true;
  });

  // If level normalization removed all chapter boundaries (e.g. all sections
  // were unnumbered), fall back to treating level ≤ 3 sections as chapters.
  if (chapterBoundaries.length === 0) {
    chapterBoundaries = located.filter((l) => {
      if (l.level > 3) return false;
      const t = l.title.toLowerCase().trim();
      return !/^(table of contents|目录|目次|contents)$/.test(t);
    });
  }

  // If there's only one chapter (or none), treat the whole doc as a single chunk.
  if (chapterBoundaries.length <= 1) {
    // Try to find content start (skip cover/TOC by starting from first section).
    const startPos = located[0]?.offset ?? 0;
    const content = markdown.slice(startPos).trim();
    if (!content) return [];
    const title = chapterBoundaries[0]?.title ?? "Document";
    return [{
      headingPath: title,
      h1: title,
      h2: null,
      content,
      tokenCount: estimateTokens(content),
      isAtomic: false,
    }];
  }

  // Split into chapters.
  const macros: MacroChunk[] = [];

  for (let i = 0; i < chapterBoundaries.length; i++) {
    const startBoundary = chapterBoundaries[i];
    const endOffset = i + 1 < chapterBoundaries.length
      ? chapterBoundaries[i + 1].offset
      : markdown.length;

    const chapterContent = markdown.slice(startBoundary.offset, endOffset).trim();
    if (!chapterContent) continue;

    const chapterTitle = startBoundary.title;
    const chapterTokens = estimateTokens(chapterContent);

    // If the chapter fits within the token limit, emit it as a single macro.
    if (chapterTokens <= chunkMaxTokens) {
      macros.push({
        headingPath: chapterTitle,
        h1: chapterTitle,
        h2: null,
        content: chapterContent,
        tokenCount: chapterTokens,
        isAtomic: false,
      });
      continue;
    }

    // Chapter is too large — split by subsections (level 3+) within its range.
    const subSections = located.filter(
      (l) => l.level > 2 && l.offset >= startBoundary.offset && l.offset < endOffset,
    );

    if (subSections.length === 0) {
      // No subsections to split on. If the chapter is very large, pre-split
      // by lines to avoid overwhelming the downstream ONNX semantic chunker
      // (which can timeout/crash on inputs >~10K tokens of dense text).
      if (chapterTokens > chunkMaxTokens * 1.5) {
        macros.push(...splitByLines(chapterContent, chapterTitle, chapterTitle, chunkMaxTokens));
      } else {
        macros.push({
          headingPath: chapterTitle,
          h1: chapterTitle,
          h2: null,
          content: chapterContent,
          tokenCount: chapterTokens,
          isAtomic: false,
        });
      }
      continue;
    }

    // Split by subsections. Content before the first subsection (the chapter
    // intro) gets its own macro.
    const subBoundaries = [
      { offset: startBoundary.offset, title: chapterTitle, level: 2 },
      ...subSections,
      { offset: endOffset, title: "__END__", level: 0 },
    ];

    let currentSubTitle: string | null = null;
    let currentSubLevel = 2;
    let currentStart = -1;

    for (let j = 0; j < subBoundaries.length - 1; j++) {
      const subStart = subBoundaries[j];
      const subEnd = subBoundaries[j + 1];
      const subContent = markdown.slice(subStart.offset, subEnd.offset).trim();

      if (!subContent) continue;

      // Build headingPath: chapter > subsection (if level > 2).
      const headingPath = subStart.level <= 2
        ? chapterTitle
        : `${chapterTitle} > ${subStart.title}`;

      const subTokens = estimateTokens(subContent);

      // Coalesce tiny subsections into the current accumulator if same path.
      if (subTokens < MIN_CHUNK_TOKENS && macros.length > 0) {
        const last = macros[macros.length - 1];
        if (last.headingPath === headingPath || last.h1 === chapterTitle) {
          last.content += "\n\n" + subContent;
          last.tokenCount += subTokens;
          continue;
        }
      }

      // SAFETY NET: a subsection segment can still be far over the chunk limit
      // when the chapter has sparse sub-headings (e.g. a 29K-token book chapter
      // with a single short sub-heading at the very end — the chapter intro
      // segment carries ~28K tokens). Feeding that to the ONNX semantic chunker
      // (which embeds every sentence at once) exhausts memory and crashes
      // `local_chunk.py`. When the segment exceeds 1.5× the limit, hard-split
      // it by lines first; the semantic chunker then only refines reasonably-
      // sized blocks. Segments under the limit are emitted unchanged.
      if (subTokens > chunkMaxTokens * 1.5) {
        const split = splitByLines(subContent, headingPath, chapterTitle, chunkMaxTokens);
        // Preserve the subsection title as h2 on each line-split macro so the
        // breadcrumb path stays accurate (splitByLines sets h2=null).
        if (subStart.level > 2) {
          for (const m of split) m.h2 = subStart.title;
        }
        macros.push(...split);
      } else {
        macros.push({
          headingPath,
          h1: chapterTitle,
          h2: subStart.level > 2 ? subStart.title : null,
          content: subContent,
          tokenCount: subTokens,
          isAtomic: false,
        });
      }
    }

    // Handle case where no subsection produced output (shouldn't happen, but
    // guard against empty macros).
    const lastMacro = macros[macros.length - 1];
    if (!lastMacro || lastMacro.h1 !== chapterTitle) {
      macros.push({
        headingPath: chapterTitle,
        h1: chapterTitle,
        h2: null,
        content: chapterContent,
        tokenCount: chapterTokens,
        isAtomic: false,
      });
    }
  }

  return macros;
}

/**
 * Load and parse structure.json from a file path.
 * Returns null if the file doesn't exist or fails to parse.
 */
export async function loadStructure(structurePath: string | null): Promise<StructureJson | null> {
  if (!structurePath) return null;
  try {
    const fs = await import("fs");
    const raw = fs.readFileSync(structurePath, "utf-8");
    const parsed = JSON.parse(raw) as StructureJson;
    if (!parsed.sections || parsed.sections.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}
