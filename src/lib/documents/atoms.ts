/**
 * DocumentAtom — the persisted, enriched form of AtomicSpan.
 *
 * Atoms are the coordinate system for LLM-guided domain segmentation: segment
 * boundaries (DocumentSegment.start/endAtomIndex) reference this index. Page
 * numbers are display metadata; charStart/charEnd + atom index are the
 * authoritative boundary coords (document-type independent — DOCX page numbers
 * are unreliable, but char offsets always are).
 *
 * This module reuses buildAtomicSpans() (the proven structural parser) and
 * enriches each span with:
 *   - charStart / charEnd      (computed by replaying span text in markdown)
 *   - headingPath              (breadcrumb stack across headings)
 *   - pageStart / pageEnd      (back-filled from structure.json sections)
 *   - textPreview              (first ~120 chars, for LLM window signatures)
 *
 * It deliberately does NOT re-implement parsing — see outline/spans.ts and
 * outline/macro-split.ts for the Docling heading-misjudgment defenses.
 */
import { buildAtomicSpans, type AtomicSpan } from "@/lib/documents/outline/spans";
import { estimateTokens } from "@/lib/documents/splitter";
import fs from "fs";
import { db } from "@/lib/db";

export interface DocumentAtomRecord {
  /** Matches AtomicSpan.id (s_0000). Stable within a document version. */
  spanId: string;
  index: number;
  blockType: AtomicSpan["type"] | "unknown";
  content: string;
  tokenCount: number;
  headingPath: string | null;
  headingLevel: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  textPreview: string | null;
}

const PREVIEW_MAX_CHARS = 120;

/** Shape of a Docling structure.json `sections` entry (subset we consume). */
interface StructureSection {
  text?: string;
  level?: number;
  headingPath?: string;
  page?: number | null;
}

export interface StructureJson {
  schema?: string;
  sections?: StructureSection[];
  texts?: Array<{ text?: string; page?: number | null }>;
}

/**
 * Build enriched DocumentAtom records from markdown + optional structure.json.
 *
 * Page back-fill strategy: structure.json sections carry a `page` field. We
 * match each heading atom to the structure section whose text equals the
 * heading (case-insensitive trimmed equality), and attribute that page to the
 * atom. Non-heading atoms inherit the page of their most recent preceding
 * heading. When structure.json is absent or a heading has no page (Docling
 * often emits page:null), page fields stay null — atoms remain usable via
 * char offsets / index.
 */
export function buildDocumentAtoms(
  markdown: string,
  structure?: StructureJson | null,
): DocumentAtomRecord[] {
  const spans = buildAtomicSpans(markdown);
  if (spans.length === 0) return [];

  // Pre-compute char offsets by locating each span's text in sequence. Spans
  // are emitted in document order, so we search forward from the previous
  // match end. This is O(n) in markdown length and robust to repeated text.
  const charOffsets: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const span of spans) {
    const at = markdown.indexOf(span.text, cursor);
    if (at === -1) {
      // Text was mutated by the parser (e.g. trimmed); fall back to cursor so
      // offsets stay monotonic. charStart/charEnd become best-effort here.
      charOffsets.push({ start: cursor, end: cursor + span.text.length });
      cursor = cursor + span.text.length;
    } else {
      charOffsets.push({ start: at, end: at + span.text.length });
      cursor = at + span.text.length;
    }
  }

  // Build a heading-text → page lookup from structure.json for back-fill.
  const headingPage = new Map<string, number>();
  if (structure?.sections) {
    for (const sec of structure.sections) {
      if (sec.text && typeof sec.page === "number") {
        headingPage.set(sec.text.trim().toLowerCase(), sec.page);
      }
    }
  }

  // Walk spans tracking a heading stack (breadcrumb path) + current page.
  let headingStack: string[] = [];
  let currentPage: number | null = null;
  const atoms: DocumentAtomRecord[] = [];

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const offsets = charOffsets[i];

    if (span.type === "heading" && span.headingLevel != null) {
      // Update the breadcrumb stack at this level (replace deeper, keep shallower).
      headingStack = headingStack.slice(0, span.headingLevel - 1);
      headingStack.push(span.text);
      // Back-fill page from structure.json if available for this heading.
      const page = headingPage.get(span.text.trim().toLowerCase());
      if (typeof page === "number") currentPage = page;
    }

    atoms.push({
      spanId: span.id,
      index: i,
      blockType: span.type,
      content: span.text,
      tokenCount: span.tokenCount,
      headingPath: headingStack.length > 0 ? headingStack.join(" > ") : null,
      headingLevel: span.headingLevel ?? null,
      pageStart: currentPage,
      pageEnd: currentPage,
      charStart: offsets.start,
      charEnd: offsets.end,
      textPreview: span.text.length > PREVIEW_MAX_CHARS
        ? span.text.slice(0, PREVIEW_MAX_CHARS).replace(/\s+/g, " ").trim()
        : span.text.replace(/\s+/g, " ").trim() || null,
    });
  }

  return atoms;
}

/**
 * WindowSignature — a compressed view of a contiguous atom range used as the
 * LLM segmentation-planning input. Keeps the global-planning token cost low
 * (a 1000-page doc → ~100 windows × ~120 tokens ≪ context window).
 *
 * Generated locally (no LLM) by default; the LLM only reads these signatures,
 * never full text, during global planning.
 */
export interface WindowSignature {
  index: number;
  startAtomIndex: number;
  endAtomIndex: number; // inclusive
  tokenCount: number;
  blockTypeCounts: Record<string, number>;
  /** First heading path in the window — anchors the topic. */
  leadingHeadingPath: string | null;
  /** Up to a few preview snippets (heading/first-paragraph) for the LLM. */
  previews: string[];
}

const WINDOW_DEFAULT_TOKENS = 1500;
const WINDOW_MAX_PREVIEWS = 3;

/**
 * Group atoms into roughly token-budgeted windows for LLM planning input.
 * Windows respect heading boundaries where possible (start a new window at a
 * top-level heading) so each window is topically coherent.
 */
export function buildWindowSignatures(
  atoms: DocumentAtomRecord[],
  targetTokens: number = WINDOW_DEFAULT_TOKENS,
): WindowSignature[] {
  if (atoms.length === 0) return [];
  const windows: WindowSignature[] = [];
  let current: DocumentAtomRecord[] = [];
  let currentTokens = 0;

  const flush = (startIdx: number) => {
    if (current.length === 0) return;
    const blockTypeCounts: Record<string, number> = {};
    for (const a of current) {
      blockTypeCounts[a.blockType] = (blockTypeCounts[a.blockType] ?? 0) + 1;
    }
    const previews = current
      .filter((a) => a.blockType === "heading" || a.blockType === "paragraph")
      .slice(0, WINDOW_MAX_PREVIEWS)
      .map((a) => a.textPreview ?? "")
      .filter(Boolean);
    windows.push({
      index: windows.length,
      startAtomIndex: startIdx,
      endAtomIndex: current[current.length - 1].index,
      tokenCount: currentTokens,
      blockTypeCounts,
      leadingHeadingPath: current[0].headingPath,
      previews,
    });
    current = [];
    currentTokens = 0;
  };

  let windowStartAtom = atoms[0].index;
  for (const atom of atoms) {
    const isTopHeading = atom.blockType === "heading" && (atom.headingLevel ?? 99) <= 2;
    // Start a new window at a top-level heading if the current one is non-empty
    // AND already over half the budget — keeps windows topically coherent.
    if (isTopHeading && current.length > 0 && currentTokens >= targetTokens / 2) {
      flush(windowStartAtom);
      windowStartAtom = atom.index;
    }
    current.push(atom);
    currentTokens += atom.tokenCount || estimateTokens(atom.content);
    if (currentTokens >= targetTokens) {
      flush(windowStartAtom);
      windowStartAtom = atom.index + 1;
    }
  }
  flush(windowStartAtom);
  return windows;
}

/**
 * Candidate boundaries — atom indices where a topic shift is plausible, derived
 * purely from structure (top-level headings) and large token gaps. These are
 * HINTS for the LLM; the LLM may accept, reject, or add boundaries. Local-only,
 * no LLM call.
 */
export function detectCandidateBoundaries(
  atoms: DocumentAtomRecord[],
  minSegmentTokens: number = 400,
): number[] {
  const boundaries: number[] = [];
  let lastBoundaryTokens = 0;
  let cumulative = 0;
  for (const atom of atoms) {
    cumulative += atom.tokenCount || estimateTokens(atom.content);
    const isTopHeading = atom.blockType === "heading" && (atom.headingLevel ?? 99) <= 2;
    if (isTopHeading && cumulative - lastBoundaryTokens >= minSegmentTokens) {
      boundaries.push(atom.index);
      lastBoundaryTokens = cumulative;
    }
  }
  return boundaries;
}

/** Batch size for createMany — SQLite has a 999-host-parameter ceiling. */
const ATOM_CREATE_BATCH = 80;

/**
 * Parse + persist DocumentAtom rows for a document. Idempotent: deletes any
 * existing atoms for the doc before inserting. Reads structure.json (if present)
 * for page back-fill. Safe to call on every convert/reprocess.
 *
 * Returns the count of atoms persisted (0 if markdown is empty). Non-throwing
 * on parse failure — atoms are an enhancement, not a hard dependency.
 */
export async function persistDocumentAtoms(
  docId: string,
  markdown: string,
  structurePath: string | null,
): Promise<number> {
  let structure: StructureJson | null = null;
  if (structurePath) {
    try {
      const raw = await fs.promises.readFile(structurePath, "utf-8").catch(() => null);
      if (raw) structure = JSON.parse(raw) as StructureJson;
    } catch {
      // Malformed structure.json — proceed without page back-fill.
      structure = null;
    }
  }

  let atoms: DocumentAtomRecord[];
  try {
    atoms = buildDocumentAtoms(markdown, structure);
  } catch (err) {
    console.warn(`[atoms] failed to build atoms for doc ${docId} (non-blocking):`, err);
    return 0;
  }

  await db.documentAtom.deleteMany({ where: { documentId: docId } });
  if (atoms.length === 0) return 0;

  // Batch to stay under SQLite's host-parameter limit (each row has ~14 cols).
  for (let i = 0; i < atoms.length; i += ATOM_CREATE_BATCH) {
    const batch = atoms.slice(i, i + ATOM_CREATE_BATCH);
    await db.documentAtom.createMany({
      data: batch.map((a) => ({
        documentId: docId,
        index: a.index,
        spanId: a.spanId,
        blockType: a.blockType,
        content: a.content,
        tokenCount: a.tokenCount,
        headingPath: a.headingPath,
        headingLevel: a.headingLevel,
        pageStart: a.pageStart,
        pageEnd: a.pageEnd,
        charStart: a.charStart,
        charEnd: a.charEnd,
        textPreview: a.textPreview,
      })),
    });
  }
  return atoms.length;
}
