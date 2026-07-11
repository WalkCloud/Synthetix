"""Synthetix document converter — Docling-only.

Usage: python convert.py <input_file> <output_dir>
Output: prints JSON to stdout with conversion results.

On success (exit 0):
  {
    "markdown": "<output_dir>/full.md",
    "structure": "<output_dir>/structure.json",
    "imageManifest": "<output_dir>/images/manifest.json" | null,
    "imageCount": N,
    "format": ".ext",
    "conversionMethod": "docling",
    "metadata": { "pageCount": N, "hasTables": bool, "hasFigures": bool, "hasStructure": bool }
  }

On failure (exit 1):
  { "error": "...", "conversionMethod": "docling" }
"""
import sys
import os
import json
import hashlib
import threading
import time
import traceback

from docling.document_converter import (
    DocumentConverter,
    PdfFormatOption,
)
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.backend.msword_backend import MsWordDocumentBackend
from docling.backend.mspowerpoint_backend import MsPowerpointDocumentBackend


# ── Performance: docx/pptx conversion speedup ─────────────────────────────
#
# ROOT CAUSE (verified via faulthandler stack dumps): the dominant cost in
# Docling's MsWordDocumentBackend is NOT images — it's the per-run STYLE query.
# _get_format_from_run() calls python-docx's `paragraph.style`, which climbs
# the style inheritance chain via repeated XML xpath lookups. For a 3415-paragraph
# docx with multiple runs each, this means hundreds of thousands of xpath calls,
# taking ~40 minutes on an 88MB document.
#
# The style query only serves to detect bold (for formatting metadata). Bold
# formatting is meaningless for RAG/wiki/graph (text-only consumers). We
# monkeypatch _get_format_from_run to skip the style-inheritance climb entirely,
# reading only the run's own direct formatting. Verified: 40min → 70s (~34x).
#
# Additionally we skip all image extraction paths (pictures carry no value for
# RAG) to save the PIL re-encoding + LibreOffice rendering cost.

_docx_patches_applied = False


def emit_progress(stage: str, progress: int, message: str, **extra) -> None:
    event = {
        "type": "progress",
        "stage": stage,
        "progress": max(0, min(100, int(progress))),
        "message": message,
    }
    event.update({k: v for k, v in extra.items() if v is not None})
    print(json.dumps(event, ensure_ascii=False), file=sys.stderr, flush=True)


class ProgressHeartbeat:
    def __init__(self, stage: str, start_progress: int, max_progress: int, message: str, interval_s: int = 20):
        self.stage = stage
        self.start_progress = start_progress
        self.max_progress = max_progress
        self.message = message
        self.interval_s = interval_s
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._started_at = time.monotonic()

    def __enter__(self):
        emit_progress(self.stage, self.start_progress, self.message)
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._stop.set()
        self._thread.join(timeout=1)

    def _run(self):
        while not self._stop.wait(self.interval_s):
            elapsed = max(0, int(time.monotonic() - self._started_at))
            # Slow, bounded progress so the UI shows liveness without claiming
            # Docling internals are farther along than we can actually know.
            progress = min(self.max_progress, self.start_progress + elapsed // self.interval_s)
            emit_progress(self.stage, progress, self.message, elapsedSeconds=elapsed)


def _apply_docx_performance_patches():
    """Monkeypatch MsWordDocumentBackend to skip the slow style-inheritance
    climb and all image handling. Idempotent — safe to call repeatedly."""
    global _docx_patches_applied
    if _docx_patches_applied:
        return
    _docx_patches_applied = True
    try:
        from docling_core.types.doc.document import Formatting, Script

        def _fast_get_format_from_run(self, run, paragraph=None):
            """Replacement that reads only the run's OWN formatting, never
            climbing the paragraph style inheritance chain (the slow path).
            Bold/italic/etc. that come from a style rather than the run itself
            are lost — acceptable, since formatting is irrelevant for RAG."""
            is_bold = bool(run.bold)
            is_italic = bool(run.italic)
            is_strikethrough = bool(run.font.strike) if hasattr(run.font, "strike") else False
            is_underline = bool(run.underline) if run.underline is not None else False
            is_sub = bool(run.font.subscript)
            is_sup = bool(run.font.superscript)
            script = Script.SUB if is_sub else Script.SUPER if is_sup else Script.BASELINE
            return Formatting(
                bold=is_bold,
                italic=is_italic,
                underline=is_underline,
                strikethrough=is_strikethrough,
                script=script,
            )

        MsWordDocumentBackend._get_format_from_run = _fast_get_format_from_run

        # Skip all image extraction/rendering — pictures have no RAG value and
        # the extraction (PIL re-encoding + LibreOffice fallback) is costly.
        MsWordDocumentBackend._handle_pictures = lambda self, drawing_blip, doc: []
        MsWordDocumentBackend._handle_vml_pictures = lambda self, vml_images, doc: []
        MsWordDocumentBackend._handle_drawingml = lambda self, doc, drawingml_els: None

        # Apply the same image-skip to PowerPoint if the methods exist there.
        for m in ("_handle_pictures", "_handle_vml_pictures"):
            if hasattr(MsPowerpointDocumentBackend, m):
                setattr(MsPowerpointDocumentBackend, m, lambda self, *a, **k: [])
        if hasattr(MsPowerpointDocumentBackend, "_handle_drawingml"):
            MsPowerpointDocumentBackend._handle_drawingml = lambda self, doc, els: None
    except Exception as e:
        # Patches are best-effort — if they fail, conversion proceeds with the
        # original (slow) Docling behavior rather than crashing.
        print(f"[convert] WARNING: failed to apply docx performance patches: {e}", flush=True)


def _pdf_text_layer_ratio(path: str, sample_threshold: int = 200) -> tuple[int, int, float]:
    """Measure the PDF's text-layer coverage across ALL pages.

    Replaces the old `_pdf_has_text_layer` which only sampled the first 5
    pages — inaccurate for documents whose early pages are cover/TOC images
    (e.g. the 277-page book that has 92% text overall but 0% on its first 2
    pages). Full coverage also drives the bypass decision (≥80 pages & ≥50%
    text → pypdfium2 fast path), so a precise ratio matters.

    For very long PDFs (>sample_threshold pages) we sample evenly across the
    document to bound cost — a 1000-page full scan pays ~4s; sampling 200
    keeps it under 1s while still representative.

    Returns (page_count, text_pages, ratio). On any failure, ratio=1.0 so the
    caller defaults to the docling-without-OCR fast path (the common case).
    """
    try:
        import pypdfium2  # type: ignore
        pdf = pypdfium2.PdfDocument(path)
        try:
            total = len(pdf)
            if total == 0:
                return 0, 0, 1.0

            # Decide which pages to probe: all of them, or an even sample.
            if total <= sample_threshold:
                indices = range(total)
                denom = total
            else:
                step = total / sample_threshold
                indices = (int(i * step) for i in range(sample_threshold))
                denom = sample_threshold

            text_pages = 0
            for i in indices:
                try:
                    text = pdf[i].get_textpage().get_text_range()
                    if len(text.strip()) > 50:
                        text_pages += 1
                except Exception:
                    continue
            ratio = text_pages / denom if denom else 1.0
            return total, text_pages, ratio
        finally:
            pdf.close()
    except Exception:
        # If detection fails, assume text layer exists (the common case) so we
        # default to the docling-without-OCR fast path. Force-OCR env flag is
        # the safety override.
        return 0, 0, 1.0


def _build_converter(input_file: str, ext: str, needs_ocr: bool | None = None) -> DocumentConverter:
    """Build a DocumentConverter with format-specific performance tuning.

    - docx/pptx: monkeypatched backends that skip slow style queries + image
      extraction (the dominant cost). Verified ~34x speedup on 88MB docx.
    - pdf: needs_ocr controls OCR (caller computes it from text-layer ratio).
      When needs_ocr is None, it falls back to the CONVERT_FORCE_OCR env flag
      only (treating absence as "no OCR"), keeping backwards behavior for
      callers that haven't pre-computed the ratio.
    - other formats: default options (already lightweight).
    """
    if ext in (".docx", ".pptx"):
        # Patches modify the backend class in place; applied once per process.
        _apply_docx_performance_patches()
        return DocumentConverter()

    if ext == ".pdf":
        force_ocr = os.environ.get("CONVERT_FORCE_OCR", "false").lower() == "true"
        if needs_ocr is None:
            # Caller didn't pre-compute; assume digital (no OCR) unless forced.
            needs_ocr = force_ocr
        else:
            needs_ocr = force_ocr or needs_ocr
        pipeline_opts = PdfPipelineOptions(
            do_ocr=needs_ocr,
            generate_picture_images=False,
            # Table structure recognition is kept for PDF — scanned tables need
            # the model to recover cell layout. For docx/pptx it's skipped
            # implicitly via the backend (python-docx reads cells natively).
        )
        format_options = {
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_opts),
        }
        return DocumentConverter(format_options=format_options)

    # html / txt / md / xlsx / csv / epub — already lightweight, use defaults.
    return DocumentConverter()


# ── pypdfium2 fast-path bypass ────────────────────────────────────────────
#
# docling-parse's C++ backend has a memory-accumulation issue on Windows
# that surfaces as two distinct failure modes:
#
#   1. Silent truncation (the common case): individual pages hit
#      std::bad_alloc, docling's pipeline swallows the error, and convert()
#      returns successfully with only the surviving pages. Verified on a
#      45-page PDF where pages 4-45 all failed (only the TOC pages survived).
#      → Handled by _should_retry_via_pypdfium (post-conversion coverage check).
#
#   2. Process-level crash (the catastrophic case): on very large PDFs the
#      memory accumulation exhausts the process and docling raises or the
#      worker is killed, producing no usable output at all. Upstream reports
#      (docling-parse #286, #227, docling #3671) describe this for
#      multi-hundred-page PDFs. The coverage check cannot recover from this
#      because convert() never returns.
#      → Handled by the pre-emptive bypass below.
#
# For large digital PDFs we skip docling entirely and extract text with
# pypdfium2 (Chrome's PDFium, via a C binding). It is dramatically cheaper
# and crash-free. The trade-off is no table recognition and a heuristic-only
# structure.json — both acceptable for RAG, and the downstream pipeline has
# graceful-degradation paths for missing structure (markdown-AST chunking +
# LLM refinement).

# Pages at/above this count AND with sufficient text-layer coverage bypass
# docling for the pypdfium2 fast path. This threshold ONLY guards against
# failure mode 2 (process crash); failure mode 1 (silent truncation) is
# content-driven and can occur at any size, so it is handled separately by
# the post-conversion coverage check. Do NOT lower this threshold to catch
# mid-size truncations — that would sacrifice docling's table/structure
# quality for PDFs that convert fine. The coverage check is the right tool
# for truncations.
BYPASS_MIN_PAGES = 80
BYPASS_MIN_TEXT_RATIO = 0.5

# Post-conversion coverage thresholds. If docling's output covers fewer than
# this fraction of the PDF's text-bearing pages, OR fewer than this fraction
# of the PDF's extractable characters, we treat the conversion as a silent
# failure and retry via the pypdfium2 bypass. See _should_retry_via_pypdfium.
COVERAGE_MIN_PAGE_RATIO = 0.6
COVERAGE_MIN_CHAR_RATIO = 0.4

# Minimum text length on a single page for it to count as "has text layer".
TEXT_LAYER_MIN_CHARS = 50


def _is_heading_like(line: str) -> bool:
    """Heuristic: does this line look like a section heading?

    Used to synthesize a structure.json from raw pypdfium2 text, since
    pypdfium2 gives us no document structure — just per-page text. The
    downstream `splitByStructure` consumer only needs section text + a
    level; absolute precision isn't required (mismatches fall through to
    the markdown-AST splitter).
    """
    s = line.strip()
    if not s or len(s) > 60:
        return False
    # "第X章/节/部分", "Chapter N", "前言/序言/目录/附录/结语"
    if s.startswith(("第", "Chapter ", "前言", "序言", "目录", "附录", "结语", "后记", "引言")):
        return True
    # Numbered headings: "1 标题", "2.1 标题", "1.1.1 标题" (but not "2024年" or "1.5倍")
    import re
    if re.match(r"^\d+(\.\d+){0,3}\s+\S", s) and not s.endswith(("年", "倍", "%", "。")):
        return True
    return False


def _heading_level(text: str) -> int:
    """Infer a heading level (2=chapter, 3=section, 4=subsection) for
    synthesis purposes. Mirrors `inferLevelFromText` in structure-split.ts."""
    s = text.strip()
    if s.startswith("第") and ("章" in s[:8] or "部分" in s[:10]):
        return 2
    if s.startswith(("前言", "序言", "目录", "附录", "结语", "后记", "引言")):
        return 2
    import re
    m = re.match(r"^(\d+(?:\.\d+)*)\s", s)
    if m:
        return min(len(m.group(1).split(".")) + 1, 6)
    return 3


def _convert_via_pypdfium(path: str, output_dir: str, on_progress: "ConvertProgressFn | None" = None) -> dict:
    """Extract text via pypdfium2 and synthesize markdown + structure.json.

    This is the bypass path for large digital PDFs where docling's C++
    backend crashes (std::bad_alloc). Output dict matches the docling path's
    shape so callers (convertDocumentFile) are agnostic to which path ran.
    """
    import pypdfium2  # type: ignore

    emit_progress("bypass_initializing", 12, "Preparing pypdfium2 fast-path extractor")
    pdf = pypdfium2.PdfDocument(path)
    try:
        total_pages = len(pdf)

        md_parts: list[str] = []
        sections: list[dict] = []
        text_entries: list[dict] = []
        tables: list[dict] = []
        pictures: list[dict] = []

        for i in range(total_pages):
            try:
                raw_text = pdf[i].get_textpage().get_text_range()
            except Exception:
                raw_text = ""
            page_no = i + 1
            text = raw_text.strip()

            if not text:
                # Keep empty-page markers so page numbers stay aligned (some
                # consumers correlate page numbers with the source PDF).
                md_parts.append(f"<!-- page {page_no} empty -->\n")
                continue

            # Split into lines; mark heading-like lines as ## / ### headings so the
            # downstream markdown-AST splitter and atom builder pick them up even
            # if structure.json's sections don't cover them.
            lines = text.splitlines()
            rendered_lines: list[str] = []
            for line in lines:
                s = line.strip()
                if s and _is_heading_like(s):
                    level = _heading_level(s)
                    prefix = "#" * min(level, 6)
                    rendered_lines.append(f"{prefix} {s}")
                    sections.append({
                        "label": "section_header",
                        "level": level,
                        "text": s,
                        "headingPath": "",
                        "page": page_no,
                    })
                else:
                    rendered_lines.append(s)
            page_md = "\n".join(rendered_lines).strip()
            md_parts.append(f"<!-- page {page_no} -->\n{page_md}\n")
            text_entries.append({"text": text[:5000], "page": page_no})

            if (i + 1) % 25 == 0 or i == total_pages - 1:
                emit_progress(
                    "bypass_extracting", 15, "Extracting text via pypdfium2",
                    processed=page_no, total=total_pages,
                )
    finally:
        pdf.close()

    markdown = "\n\n".join(md_parts)
    md_path = os.path.join(output_dir, "full.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(markdown)

    structure = {
        "schema": "pypdfium2_heuristic_v1",
        "sections": sections,
        "texts": text_entries,
        "tables": tables,
        "pictures": pictures,
    }
    structure_path = os.path.join(output_dir, "structure.json")
    with open(structure_path, "w", encoding="utf-8") as f:
        json.dump(structure, f, ensure_ascii=False, indent=2)

    emit_progress("bypass_finalizing", 90, "pypdfium2 extraction complete")

    return {
        "markdown": md_path,
        "structure": structure_path,
        "imageManifest": None,
        "imageCount": 0,
        "format": os.path.splitext(path)[1].lower(),
        "conversionMethod": "pypdfium2",
        "metadata": {
            "pageCount": total_pages,
            "hasTables": False,
            "hasFigures": False,
            "hasStructure": len(sections) > 0,
        },
    }


def _quick_pdf_char_count(path: str, max_pages: int = 0) -> int:
    """Fast total-character probe for the docling-failure fallback decision.

    Returns the total non-whitespace char count across the PDF's pages. Used
    to decide whether docling's near-empty output means it silently failed
    (bad_alloc swallowed) and we should retry via pypdfium2.

    When max_pages <= 0, scans ALL pages (pages are cheap to probe via the
    C binding: ~1s for a few hundred pages). A positive max_pages caps the
    scan to the first N pages (front-loaded sampling) for callers that only
    need a rough estimate.
    """
    try:
        import pypdfium2  # type: ignore
        pdf = pypdfium2.PdfDocument(path)
        try:
            total = 0
            limit = len(pdf) if max_pages <= 0 else min(max_pages, len(pdf))
            for i in range(limit):
                try:
                    text = pdf[i].get_textpage().get_text_range()
                    total += len(text.strip())
                except Exception:
                    continue
            return total
        finally:
            pdf.close()
    except Exception:
        return 0


def _docling_output_page_set(doc) -> set[int]:
    """Collect the set of page numbers that docling actually produced output for.

    When docling-parse hits std::bad_alloc on a page, that page's items are
    simply absent from the resulting document. By comparing the set of pages
    docling covered against the PDF's total page count, we can detect silent
    truncation even when the surviving pages (e.g. a long TOC) contribute
    enough characters to mask the loss.
    """
    pages: set[int] = set()
    for item, _level in doc.iterate_items():
        prov = getattr(item, "prov", None)
        if not prov:
            continue
        entry = prov[0] if isinstance(prov, list) else prov
        pno = getattr(entry, "page_no", None)
        if pno is None and isinstance(entry, dict):
            pno = entry.get("page_no")
        if isinstance(pno, int) and pno > 0:
            pages.add(pno)
    return pages


def _pdf_text_page_count(path: str) -> tuple[int, int]:
    """Count total pages and text-bearing pages in the PDF via pypdfium2.

    Returns (total_pages, text_pages). Used by the post-conversion coverage
    check to know how many pages *should* have content.
    """
    try:
        import pypdfium2  # type: ignore
        pdf = pypdfium2.PdfDocument(path)
        try:
            total = len(pdf)
            text_pages = 0
            for i in range(total):
                try:
                    text = pdf[i].get_textpage().get_text_range()
                    if len(text.strip()) > TEXT_LAYER_MIN_CHARS:
                        text_pages += 1
                except Exception:
                    continue
            return total, text_pages
        finally:
            pdf.close()
    except Exception:
        return 0, 0


def _should_retry_via_pypdfium(path: str, doc, markdown: str) -> tuple[bool, str]:
    """Decide whether docling silently failed and we should retry via pypdfium2.

    docling-parse's C++ backend can hit std::bad_alloc on individual pages
    without raising — the page is just missing from the output. When enough
    pages fail the resulting markdown is incomplete, yet non-empty (a long TOC
    alone can yield tens of thousands of chars). The old check (markdown <
    100 chars) only caught near-total failures and missed this partial-truncation
    case.

    Two independent signals are evaluated; either one triggers the retry:

    1. Page coverage — docling produced output for fewer than
       COVERAGE_MIN_PAGE_RATIO of the PDF's text-bearing pages.
    2. Character coverage — docling's non-whitespace char count is less than
       COVERAGE_MIN_CHAR_RATIO of what pypdfium2 extracts from the same PDF.

    Returns (should_retry, reason). The reason string is suitable for logging.
    """
    md_chars = len(markdown.strip())
    if md_chars == 0:
        return True, "docling produced empty output"

    total_pages, text_pages = _pdf_text_page_count(path)
    if text_pages == 0:
        # No text layer detectable — likely a scanned PDF; can't judge coverage.
        return False, "no text layer to compare"

    # Signal 1: page coverage.
    docling_pages = _docling_output_page_set(doc)
    page_ratio = len(docling_pages) / text_pages if text_pages else 1.0
    if page_ratio < COVERAGE_MIN_PAGE_RATIO:
        return True, (
            f"page coverage {len(docling_pages)}/{text_pages} "
            f"({page_ratio:.0%}) < {COVERAGE_MIN_PAGE_RATIO:.0%}"
        )

    # Signal 2: character coverage (catches cases where page set looks fine
    # but individual pages were truncated to fragments).
    pdf_chars = _quick_pdf_char_count(path)
    if pdf_chars > 500 and md_chars < pdf_chars * COVERAGE_MIN_CHAR_RATIO:
        return True, (
            f"char coverage {md_chars}/{pdf_chars} "
            f"({md_chars / pdf_chars:.0%}) < {COVERAGE_MIN_CHAR_RATIO:.0%}"
        )

    return False, "ok"


def _build_image_manifest(doc, output_dir: str) -> tuple[list[dict], int]:
    images_dir = os.path.join(output_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    manifest = []
    img_index = 0

    for pic in doc.pictures:
        img_bytes = None
        ext = "png"

        if hasattr(pic, "image") and pic.image is not None:
            try:
                if hasattr(pic.image, "pil_image") and pic.image.pil_image is not None:
                    import io
                    buf = io.BytesIO()
                    pic.image.pil_image.save(buf, format="PNG")
                    img_bytes = buf.getvalue()
                elif hasattr(pic.image, "uri") and pic.image.uri:
                    if os.path.isfile(pic.image.uri):
                        with open(pic.image.uri, "rb") as f:
                            img_bytes = f.read()
                        _, ext = os.path.splitext(pic.image.uri)
                        ext = ext.lstrip(".") or "png"
            except Exception:
                continue

        if img_bytes is None:
            continue

        if len(img_bytes) < 100:
            continue

        if ext == "jpeg":
            ext = "jpg"

        h = hashlib.md5(img_bytes).hexdigest()[:8]
        filename = f"img_{img_index:03d}_{h}.{ext}"
        filepath = os.path.join(images_dir, filename)
        with open(filepath, "wb") as f:
            f.write(img_bytes)

        page = None
        if hasattr(pic, "prov") and pic.prov:
            prov = pic.prov[0] if isinstance(pic.prov, list) else pic.prov
            if hasattr(prov, "page_no"):
                page = prov.page_no
            elif isinstance(prov, dict):
                page = prov.get("page_no")

        caption = None
        if hasattr(pic, "caption") and pic.caption:
            cap = pic.caption
            if hasattr(cap, "text"):
                caption = cap.text
            elif isinstance(cap, str):
                caption = cap

        ref = ""
        if hasattr(pic, "self_ref"):
            ref = str(pic.self_ref)

        manifest.append({
            "ref": ref,
            "filename": filename,
            "path": f"images/{filename}",
            "page": page,
            "caption": caption,
            "size": len(img_bytes),
        })
        img_index += 1

    return manifest, img_index


def _build_structure_json(doc) -> dict:
    structure = {
        "schema": "docling_structure_v1",
        "sections": [],
        "texts": [],
        "tables": [],
        "pictures": [],
    }

    for item, level in doc.iterate_items():
        label = getattr(item, "label", "unknown")
        text = getattr(item, "text", None) or ""
        heading_path = ""

        if hasattr(item, "heading_path"):
            hp = item.heading_path
            if hasattr(hp, "sections"):
                heading_path = " > ".join(
                    s.text for s in hp.sections if hasattr(s, "text")
                )
            elif isinstance(hp, str):
                heading_path = hp

        page_no = None
        if hasattr(item, "prov") and item.prov:
            prov = item.prov[0] if isinstance(item.prov, list) else item.prov
            if hasattr(prov, "page_no"):
                page_no = prov.page_no
            elif isinstance(prov, dict):
                page_no = prov.get("page_no")

        entry = {
            "label": label,
            "level": level,
            "text": text[:5000],
            "headingPath": heading_path,
            "page": page_no,
        }

        if label == "section_header":
            structure["sections"].append(entry)
        elif label == "table":
            md_text = ""
            if hasattr(item, "export_to_markdown"):
                try:
                    result_obj = item.export_to_markdown(doc)
                    md_text = result_obj.text if hasattr(result_obj, "text") else str(result_obj)
                except TypeError:
                    try:
                        md_text = item.export_to_markdown().text
                    except Exception:
                        pass
                except Exception:
                    pass
            entry["markdown"] = md_text
            structure["tables"].append(entry)
        elif label in ("picture", "figure"):
            entry["pictureRef"] = str(getattr(item, "self_ref", ""))
            structure["pictures"].append(entry)
        else:
            structure["texts"].append(entry)

    return structure


def convert(input_file: str, output_dir: str) -> dict:
    output_dir = os.path.abspath(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    if not os.path.isdir(output_dir):
        raise RuntimeError(f"Failed to create output directory: {output_dir}")

    ext = os.path.splitext(input_file)[1].lower()

    # ── PDF bypass decision ───────────────────────────────────────────────
    # Only the largest digital PDFs (≥BYPASS_MIN_PAGES) bypass docling
    # pre-emptively, to avoid the *hard-crash* failure mode (C++ backend
    # exhausting memory and raising). Smaller PDFs go through docling first
    # to preserve its table/structure quality; if docling silently truncates
    # them the post-conversion coverage check below catches it and retries
    # via pypdfium2.
    if ext == ".pdf":
        total_pages, text_pages, text_ratio = _pdf_text_layer_ratio(input_file)
        if total_pages >= BYPASS_MIN_PAGES and text_ratio >= BYPASS_MIN_TEXT_RATIO:
            emit_progress(
                "bypass", 10,
                f"Using pypdfium2 fast path ({total_pages} pages, "
                f"{text_ratio:.0%} text layer) — bypassing docling to avoid "
                f"known C++ memory bug on large PDFs",
            )
            return _convert_via_pypdfium(input_file, output_dir)
        needs_ocr = text_ratio < BYPASS_MIN_TEXT_RATIO
        emit_progress("initializing", 10, "Preparing Docling converter")
        converter = _build_converter(input_file, ext, needs_ocr=needs_ocr)
    else:
        emit_progress("initializing", 10, "Preparing Docling converter")
        converter = _build_converter(input_file, ext)

    with ProgressHeartbeat("docling_convert", 15, 55, "Converting document with Docling"):
        result = converter.convert(input_file)
    emit_progress("docling_convert", 60, "Docling conversion completed")
    doc = result.document

    emit_progress("export_markdown", 65, "Exporting markdown")
    markdown = doc.export_to_markdown()

    # ── PDF failure fallback ──────────────────────────────────────────────
    # docling sometimes "succeeds" (no exception) but emits truncated output
    # because pages hit std::bad_alloc and the error was swallowed by the
    # pipeline. The old check (markdown < 100 chars) only caught near-total
    # failures; a long TOC alone can yield tens of thousands of chars while
    # every content page was lost. We now compare docling's output against
    # the PDF's actual content via two coverage signals (page + char ratio).
    if ext == ".pdf":
        should_retry, reason = _should_retry_via_pypdfium(input_file, doc, markdown)
        if should_retry:
            print(
                f"[convert] docling output failed coverage check ({reason}); "
                f"falling back to pypdfium2",
                file=sys.stderr, flush=True,
            )
            return _convert_via_pypdfium(input_file, output_dir)

    md_path = os.path.join(output_dir, "full.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(markdown)
    emit_progress("export_markdown", 70, "Markdown exported")

    emit_progress("export_structure", 75, "Exporting document structure")
    structure = _build_structure_json(doc)
    structure_path = os.path.join(output_dir, "structure.json")
    with open(structure_path, "w", encoding="utf-8") as f:
        json.dump(structure, f, ensure_ascii=False, indent=2)
    emit_progress("export_structure", 80, "Document structure exported")

    # Image extraction is skipped for the formats where we disabled picture
    # rendering (docx/pptx/pdf) — these images have no value for RAG and
    # extracting them is the dominant cost. Only legacy formats that still
    # produce pictures (e.g. some html/epub) go through _build_image_manifest.
    skip_images = os.environ.get("CONVERT_SKIP_IMAGES", "true").lower() != "false"
    image_manifest: list[dict] = []
    image_count = 0
    manifest_path = None
    has_pictures = len(doc.pictures) > 0 if hasattr(doc, "pictures") else False
    if (not skip_images) and has_pictures:
        image_manifest, image_count = _build_image_manifest(doc, output_dir)
        if image_count > 0:
            manifest_path = os.path.join(output_dir, "images", "manifest.json")
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump({"images": image_manifest, "count": image_count}, f, ensure_ascii=False, indent=2)

    pages_dict = doc.export_to_dict().get("pages", {})
    page_count = len(pages_dict) if isinstance(pages_dict, (dict, list)) else 0

    metadata = {
        "pageCount": page_count,
        "hasTables": len(doc.tables) > 0 if hasattr(doc, "tables") else False,
        "hasFigures": has_pictures,
        "hasStructure": len(structure["sections"]) > 0,
    }
    emit_progress("finalizing", 90, "Finalizing conversion output")

    output = {
        "markdown": md_path,
        "structure": structure_path,
        "imageManifest": manifest_path,
        "imageCount": image_count,
        "format": ext,
        "conversionMethod": "docling",
        "metadata": metadata,
    }

    return output


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: python convert.py <input_file> <output_dir>", "conversionMethod": "docling"}))
        sys.exit(1)

    input_file = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(input_file):
        print(json.dumps({"error": f"Input file not found: {input_file}", "conversionMethod": "docling"}))
        sys.exit(1)

    try:
        result = convert(input_file, output_dir)
        print(json.dumps(result, ensure_ascii=False))
    except FileNotFoundError as e:
        tb = traceback.format_exc()
        msg = f"[Errno 2] {str(e)}"
        print(json.dumps({"error": msg, "conversionMethod": "docling", "hint": "Output directory or input file not accessible. Check permissions and disk space."}))
        sys.exit(1)
    except Exception as e:
        tb = traceback.format_exc()
        msg = f"Docling conversion failed: {str(e)}"
        print(json.dumps({"error": msg, "conversionMethod": "docling", "traceback": tb}))
        sys.exit(1)


if __name__ == "__main__":
    main()
