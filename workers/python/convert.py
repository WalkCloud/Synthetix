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


def _pdf_has_text_layer(path: str, sample_pages: int = 5) -> bool:
    """Detect whether a PDF has a real text layer (digital PDF) vs scanned.

    Scanned PDFs are image-only and REQUIRE OCR. Digital PDFs already have
    selectable text, so OCR is pure waste. We sample the first few pages and
    treat meaningful text (>50 chars) as proof of a text layer.

    Returns True if a text layer is detected (skip OCR), False otherwise (OCR).
    """
    try:
        import pypdfium2  # type: ignore
        pdf = pypdfium2.PdfDocument(path)
        pages_to_check = min(sample_pages, len(pdf))
        for i in range(pages_to_check):
            try:
                text = pdf[i].get_textpage().get_text_range()
                if len(text.strip()) > 50:
                    return True
            except Exception:
                continue
        return False
    except Exception:
        # If detection fails, assume text layer exists (the common case) so we
        # default to the FAST path. Force-OCR env flag is the safety override.
        return True


def _build_converter(input_file: str, ext: str) -> DocumentConverter:
    """Build a DocumentConverter with format-specific performance tuning.

    - docx/pptx: monkeypatched backends that skip slow style queries + image
      extraction (the dominant cost). Verified ~34x speedup on 88MB docx.
    - pdf: detect text layer → disable OCR for digital PDFs (huge speedup),
      keep OCR for scanned PDFs (still required).
    - other formats: default options (already lightweight).
    """
    force_ocr = os.environ.get("CONVERT_FORCE_OCR", "false").lower() == "true"

    if ext in (".docx", ".pptx"):
        # Patches modify the backend class in place; applied once per process.
        _apply_docx_performance_patches()
        return DocumentConverter()

    if ext == ".pdf":
        needs_ocr = force_ocr or not _pdf_has_text_layer(input_file)
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

    # Format-tuned converter: docx/pptx skip vector-graphic rendering, PDF
    # disables OCR when a text layer exists. See _build_converter for rationale.
    emit_progress("initializing", 10, "Preparing Docling converter")
    converter = _build_converter(input_file, ext)
    with ProgressHeartbeat("docling_convert", 15, 55, "Converting document with Docling"):
        result = converter.convert(input_file)
    emit_progress("docling_convert", 60, "Docling conversion completed")
    doc = result.document

    emit_progress("export_markdown", 65, "Exporting markdown")
    markdown = doc.export_to_markdown()

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
