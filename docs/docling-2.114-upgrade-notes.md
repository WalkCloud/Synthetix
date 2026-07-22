# Docling 2.107.0 → 2.114.0 Upgrade Notes

> Tracking document for the v1.0.6 upgrade of the Python document-conversion
> engine. Covers API compatibility, the defensive monkeypatch hardening, and
> the local verification steps to run before shipping.

## Summary of changes in this upgrade

| File | Change |
| --- | --- |
| `workers/python/requirements.txt` | `docling>=2.107.0` → `docling>=2.114.0` |
| `src/lib/documents/converter.ts` | `CONVERSION_CACHE_VERSION` 3 → 4 (invalidates all prior caches) |
| `workers/python/convert.py` | `_apply_docx_performance_patches()` hardened with `hasattr` guards + WARNING logs |

## What's new in docling 2.114.0

Per the [v2.114.0 release](https://github.com/docling-project/docling/releases/tag/v2.114.0):

- **Feature**: Support for legacy binary Office formats (97–2004), requiring LibreOffice.
- **Feature**: `VideoPipeline` added.
- Various bug fixes and rendering refinements across the 2.108–2.114 range.

None of these touch the public APIs that `convert.py` depends on (listed below).

## Public APIs used by `convert.py`

The converter only imports from docling's public surface. These are the
imports and the methods/attributes accessed on returned objects:

```python
# Imports (stable public API)
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.backend.msword_backend import MsWordDocumentBackend
from docling.backend.mspowerpoint_backend import MsPowerpointDocumentBackend

# DocumentConverter usage
converter = DocumentConverter(format_options={...})   # or DocumentConverter()
result = converter.convert(input_file)
doc = result.document

# DoclingDocument attributes/methods accessed
doc.export_to_markdown()
doc.export_to_dict()
doc.iterate_items()      # yields (item, level)
doc.pictures             # list
doc.tables               # list

# Per-item attributes (from iterate_items)
item.label               # "section_header" | "table" | "picture" | "figure" | ...
item.text
item.heading_path        # has .sections or is a str
item.prov                # list or single — each entry has .page_no or {"page_no": N}
item.self_ref
item.export_to_markdown(doc)  # for table items
```

These are all part of docling's documented public API and have been stable
across the 2.x line.

## Monkeypatched internal methods (defensive hardening)

The performance patches in `_apply_docx_performance_patches()` override
**internal** (underscore-prefixed) methods on `MsWordDocumentBackend` and
`MsPowerpointDocumentBackend`. These are NOT public API and could be renamed
or restructured by an upstream refactor. Before this upgrade they were
assigned unconditionally; now each is guarded:

| Class | Method | Patch purpose |
| --- | --- | --- |
| `MsWordDocumentBackend` | `_get_format_from_run` | Skip slow style-inheritance climb (~34x docx speedup) |
| `MsWordDocumentBackend` | `_handle_pictures` | Skip image extraction |
| `MsWordDocumentBackend` | `_handle_vml_pictures` | Skip VML image extraction |
| `MsWordDocumentBackend` | `_handle_drawingml` | Skip DrawingML extraction |
| `MsPowerpointDocumentBackend` | `_handle_pictures` | Skip image extraction |
| `MsPowerpointDocumentBackend` | `_handle_vml_pictures` | Skip VML image extraction |
| `MsPowerpointDocumentBackend` | `_handle_drawingml` | Skip DrawingML extraction |

If any of these methods no longer exist after the upgrade, the code prints:
```
[convert] WARNING: MsWordDocumentBackend._get_format_from_run not found; docling may have refactored this method (expect slow docx conversion)
```
…then falls back to docling's native (slower) behavior rather than crashing.
**After upgrading, watch for these WARNINGs in conversion logs.**

## Local verification steps

> These must be run in a local environment with Python + pip available.
> The CI/dev sandbox may not have the Python toolchain installed.

### 1. Install the new docling version

```bash
cd E:\project01
pip install -r workers/python/requirements.txt
# Verify version
python -c "import docling; print(docling.__version__)"
# Expected: 2.114.0 or higher
```

### 2. Verify monkeypatch targets still exist

```bash
python -c "
from docling.backend.msword_backend import MsWordDocumentBackend
from docling.backend.mspowerpoint_backend import MsPowerpointDocumentBackend

word_methods = ['_get_format_from_run', '_handle_pictures', '_handle_vml_pictures', '_handle_drawingml']
pptx_methods = ['_handle_pictures', '_handle_vml_pictures', '_handle_drawingml']

print('=== MsWordDocumentBackend ===')
for m in word_methods:
    print(f'  {m}: {\"OK\" if hasattr(MsWordDocumentBackend, m) else \"MISSING (WARNING expected)\"}')

print('=== MsPowerpointDocumentBackend ===')
for m in pptx_methods:
    print(f'  {m}: {\"OK\" if hasattr(MsPowerpointDocumentBackend, m) else \"MISSING\"}')
"
```

All `MsWordDocumentBackend` methods should report **OK**. If any report
MISSING, the monkeypatch for that method will no-op (logged as WARNING) and
docx conversion will fall back to the slow path. Evaluate whether the method
was renamed and update `convert.py` accordingly.

### 3. Convert a test document of each format

```bash
mkdir -p /tmp/docling-test

# PDF (small digital — should use docling path)
python workers/python/convert.py test-sample.pdf /tmp/docling-test/pdf-out

# DOCX (should apply fast patches — check stderr for absence of WARNING)
python workers/python/convert.py test-sample.docx /tmp/docling-test/docx-out

# PPTX
python workers/python/convert.py test-sample.pptx /tmp/docling-test/pptx-out

# HTML / TXT / MD (lightweight default path)
python workers/python/convert.py test-sample.html /tmp/docling-test/html-out
```

For each, verify:
- Exit code 0
- `full.md` is non-empty and readable
- `structure.json` has `schema: "docling_structure_v1"` and non-empty `sections`/`texts`
- stderr contains **no** `[convert] WARNING:` lines (their presence indicates a monkeypatch target is missing)

### 4. Verify cache invalidation

The cache version bump (3 → 4) means the first conversion of any previously-
cached document will re-run from scratch. Confirm the `.convert-cache.json`
sidecar files in your data directory show `"version": 4` after re-conversion.

## Rollback

If the upgrade causes regressions, revert these three files to the `main`
branch state:
```bash
git checkout main -- workers/python/requirements.txt \
                       src/lib/documents/converter.ts \
                       workers/python/convert.py
pip install docling>=2.107.0  # reinstall old version
```
