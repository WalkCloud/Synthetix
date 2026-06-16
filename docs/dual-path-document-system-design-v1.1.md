# Dual-Path Document System Design v1.1

> **Version**: 1.1  
> **Changes from v1.0**: Merged 6 refinements from cross-analysis review (see Appendix A for diff)  
> **Supersedes**: `dual-path-document-system-design.md` (v1.0)

## Overview

### Problem

Current document processing pipeline is a single-path RAG flow: documents are converted to markdown, chunked by regex-based heading parsing, embedded into vectors, and retrieved via semantic search during writing generation. This has fundamental limitations:

1. **Chunking is mechanical** — `splitByMacroAST()` uses regex `/^(#{1,6})\s+(.+)/` to guess heading levels. PDF multi-column layouts produce garbled text, DOCX without heading styles produce flat content, tables get fragmented.
2. **RAG retrieval is fragmented** — Each chunk is 512-1536 tokens. When writing a section that needs systematic knowledge of an entire domain (e.g. "financial analysis methodology"), 8 independent chunks cannot match a complete domain document.
3. **Images are discarded** — `sanitize.ts` converts `![alt](images/xxx.png)` to `[Image: alt]`. Images cannot be vectorized or retrieved.
4. **No domain awareness** — The system treats all chunks equally. It doesn't understand that some chunks belong to the same thematic domain.

### Solution

Introduce a dual-path architecture that runs in parallel after document conversion:

- **Path A (Domain Documents)** — Uses Docling for high-quality document structure extraction, then LLM classifies content into 2-6 thematic domains in a single call (classification + summary merged). Each domain is stored as a complete, structured document with summary. During generation, a two-stage selection (keyword pre-filter → LLM fine-select) picks relevant domains, and the full domain content is injected into the prompt **before** RAG references.

- **Path B (RAG Chunks)** — The existing pipeline continues unchanged: sanitize → macro-split → micro-split → embed → index. Semantic search retrieves top-K chunks as supplementary references.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Document converter | Docling (primary) + MarkItDown (fallback) | Docling provides precise heading hierarchy, table structure, image references, and reading order that regex parsing cannot achieve |
| Domain count | 2-6 per document | LLM-instructed. Balanced granularity — enough to be useful, not so many that selection becomes noisy |
| Domain classification | Single LLM call for classify + summarize | LLM already reads all section previews; generating summaries at classification time has near-zero marginal cost. Reduces API calls from 1+N to 1. |
| Domain identity | `stableDomainId` (content hash) | Cross-process stability: user edits survive document re-processing |
| Domain selection at generation time | Two-stage: keyword pre-filter (Top-20) → LLM fine-select (Top-4) | Reduces LLM input noise by ~90%; keyword filter is zero-cost |
| Prompt block order | Domain docs **before** RAG references | Aligns physical position with logical priority; avoids "lost in the middle" attention decay |
| Path A failure handling | Non-blocking | Document still reaches "ready" status. Path B is the critical path |
| Domain document editing | Future-only | Edits only affect subsequent generations, no cascading re-generation |
| Fallback visibility | User-visible `conversionMethod` badge | Users need to know if Docling or MarkItDown was used |
| Image mapping | `manifest.json` explicit ref → file mapping | Necessary for TS-side to associate Docling `image_ref` with actual files |
| Long domain content | Truncate to char budget (4000) | YAGNI: sub-chunking + intelligent selection is deferred to future iteration |

### Architecture Diagram

```
Document Upload
      │
      ▼
  convertDocument()          ← Phase 0: Docling primary + MarkItDown fallback
      │
      │  outputs: full.md + structure.json + images/manifest.json
      │  metadata: conversionMethod, conversionWarning
      │
      ▼
  resolveProcessingModels()
      │
      ├─── Promise.allSettled ───┐
      │                          │
      ▼                          ▼
  Path A: Domain Split       Path B: RAG Chunks
  (Phase 2)                  (existing, unchanged)
  docling-parser.ts            splitByMacroAST
  → DoclingSection[]           → MacroChunk[]
  1x LLM classify+summarize    → micro-split
  stableDomainId inherit       → embed
  → DomainDocument[] (DB)       → index
      │                          │
      └──────────┬───────────────┘
                 │
                 ▼
          auto-tag → status=ready
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
  Library UI             Section Generation
  Domain Tab (Phase 5)   Two-stage selection (Phase 4)
                         1. keyword pre-filter (Top-20)
                         2. LLM fine-select (Top-4)
                         assembleContext():
                           ... → Domain docs → RAG → target → ...
```

---

## Phase 0: Docling Integration

### Goal

Replace the 6 custom converters (DOCX/PDF/PPTX/EPUB/HTML/generic) in `convert.py` with a single Docling `DocumentConverter` call. Keep MarkItDown as fallback. Output structured document + image manifest. Surface conversion method to users.

### Why This Matters for the Whole System

Without Docling, the domain splitter in Phase 2 would use `splitByMacroAST()` (regex-based heading detection) to extract document structure. This produces inaccurate results for:

- PDF files with multi-column layouts (text order is scrambled)
- DOCX files without explicit heading styles (no `#` markers in markdown)
- Tables spanning page boundaries (broken into fragments)
- Mixed content with code blocks, figures, and formulas

Docling provides a structured `DoclingDocument` with:

- Precise `section_header` nodes with `level` 1-6
- Complete `table` nodes with cell structure
- `figure` nodes with image references
- Correct reading order for complex layouts
- OCR support for scanned documents (109 languages)

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `workers/python/convert.py` | Rewrite | Docling primary + MarkItDown fallback + image manifest |
| `workers/python/requirements.txt` | Edit | Add `docling`, remove `python-docx`, `python-pptx`, `PyMuPDF` |
| `src/lib/documents/converter.ts` | Rewrite | Change return type to `ConversionResult` with `conversionMethod` |
| `src/lib/documents/pipeline.ts` | Edit | Add `structurePath` to `ProcessingContext`, update `convertDocument()`, write `conversionMethod`/`conversionWarning` to Document |
| `prisma/schema.prisma` | Edit | Add `conversionMethod`, `conversionWarning`, `domainCount` to Document |

### 0.1 New `convert.py`

The script outputs JSON to stdout (instead of the current plain text file path). This allows returning both the markdown path, the structure path, the image manifest, and conversion metadata.

```python
import sys, os, json, traceback

def convert_with_docling(input_path, output_dir):
    from docling.document_converter import DocumentConverter
    
    converter = DocumentConverter()
    result = converter.convert(input_path)
    
    # Markdown output (for Path B RAG pipeline)
    md = result.document.export_to_markdown()
    md_path = os.path.join(output_dir, "full.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)
    
    # Structured JSON output (for Path A domain splitting)
    structure = result.document.export_to_dict()
    struct_path = os.path.join(output_dir, "structure.json")
    with open(struct_path, "w", encoding="utf-8") as f:
        json.dump(structure, f, ensure_ascii=False, indent=2)
    
    # Image extraction with manifest
    images_dir = os.path.join(output_dir, "images")
    os.makedirs(images_dir, exist_ok=True)
    image_count, manifest = _extract_images(result, images_dir)
    
    # Write image manifest for TS-side association
    manifest_path = os.path.join(images_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"images": manifest, "count": image_count}, f, ensure_ascii=False, indent=2)
    
    return {
        "markdown": md_path,
        "structure": struct_path,
        "imageManifest": manifest_path,
        "imageCount": image_count,
        "format": os.path.splitext(input_path)[1].lower(),
        "conversionMethod": "docling",
    }

def _extract_images(conversion_result, images_dir):
    """Extract images and build manifest for TS-side association."""
    manifest = []
    count = 0
    try:
        for item, _ in conversion_result.document.iterate_items():
            if hasattr(item, 'image') and item.image:
                img_bytes = item.image
                if len(img_bytes) < 500:
                    continue
                import hashlib
                h = hashlib.md5(img_bytes).hexdigest()[:8]
                fname = f"img_{count:03d}_{h}.png"
                with open(os.path.join(images_dir, fname), "wb") as f:
                    f.write(img_bytes)
                manifest.append({
                    "ref": getattr(item, 'ref', f"figure_{count}"),
                    "filename": fname,
                    "path": f"images/{fname}",
                    "page": getattr(item, 'page_no', None),
                    "caption": getattr(item, 'caption', None) or f"Figure {count}",
                    "size": len(img_bytes),
                })
                count += 1
    except Exception as e:
        import sys
        print(f"[Image extraction warning]: {e}", file=sys.stderr)
    return count, manifest

def convert_with_markitdown(input_path, output_dir):
    """MarkItDown fallback — text only, no structure."""
    from markitdown import MarkItDown
    
    md = MarkItDown()
    result = md.convert(input_path)
    md_path = os.path.join(output_dir, "full.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(result.text_content)
    
    return {
        "markdown": md_path,
        "structure": None,
        "imageManifest": None,
        "imageCount": 0,
        "format": os.path.splitext(input_path)[1].lower(),
        "conversionMethod": "markitdown",
    }

def main():
    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    if not os.path.isfile(input_path):
        print(json.dumps({"error": f"Input file not found: {input_path}"}))
        sys.exit(1)
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Primary: Docling. Fallback: MarkItDown.
    try:
        result = convert_with_docling(input_path, output_dir)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        sys.stderr.write(f"\n[Docling failed, falling back to MarkItDown]: {e}\n")
        try:
            result = convert_with_markitdown(input_path, output_dir)
            result["conversionMethod"] = "markitdown-fallback"
            result["conversionWarning"] = f"Document parsed with fallback converter. Reason: {str(e)[:200]}"
        except Exception as e2:
            print(json.dumps({"error": str(e2)}))
            sys.exit(1)
    
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
```

### 0.2 New `converter.ts`

Change from `spawnPython` with `parseJson: false` to `spawnPythonJson` with typed return.

```typescript
import path from "path";
import fs from "fs";
import { spawnPythonJson } from "@/lib/python";

const PYTHON_SCRIPT = path.resolve("workers/python/convert.py");

export interface ConversionResult {
  markdown: string;
  structure: string | null;       // null when MarkItDown fallback
  imageManifest: string | null;   // path to images/manifest.json
  imageCount: number;
  format: string;
  conversionMethod: "docling" | "markitdown" | "markitdown-fallback";
  conversionWarning?: string;
}

export function convertToMarkdown(
  inputPath: string,
  outputDir: string,
): Promise<ConversionResult> {
  if (!fs.existsSync(inputPath)) {
    return Promise.reject(new Error(`Input file does not exist: ${inputPath}`));
  }
  return spawnPythonJson<ConversionResult>(
    PYTHON_SCRIPT,
    [inputPath, outputDir],
    { timeout: 600_000 },  // 10 min — Docling first run downloads AI models
  );
}
```

### 0.3 Modified `pipeline.ts`

Add `structurePath` and `imageManifestPath` to `ProcessingContext`. Write `conversionMethod`/`conversionWarning` to Document record.

```typescript
// ProcessingContext — add fields
export interface ProcessingContext {
  // ... existing fields ...
  structurePath: string | null;
  imageManifestPath: string | null;
}

// convertDocument() — updated
export async function convertDocument(
  ctx: ProcessingContext,
  storage: StorageAdapter,
): Promise<string> {
  const outputDir = storage.getDocumentDir(ctx.docId, ctx.doc.userId);
  const originalPath = storage.getFilePath(ctx.doc.originalPath);
  
  const result = await convertToMarkdown(originalPath, outputDir);
  
  ctx.outputDir = outputDir;
  ctx.markdownPath = result.markdown;
  ctx.structurePath = result.structure;
  ctx.imageManifestPath = result.imageManifest;
  
  // Write conversion metadata to Document record
  await db.document.update({
    where: { id: ctx.docId },
    data: {
      conversionMethod: result.conversionMethod,
      conversionWarning: result.conversionWarning || null,
    },
  });
  
  if (result.conversionMethod !== "docling") {
    console.warn(`Docling fallback: ${result.conversionWarning}`);
  }
  
  return fs.readFileSync(result.markdown, "utf-8");
}
```

### 0.4 Document Schema Extensions

Add to `Document` model in `prisma/schema.prisma`:

```prisma
model Document {
  // ... existing fields ...
  domainDocuments   DomainDocument[]
  conversionMethod  String?   // "docling" | "markitdown" | "markitdown-fallback"
  conversionWarning String?
  domainCount       Int       @default(0)
}
```

### 0.5 Updated `requirements.txt`

```diff
+ docling>=2.15.0
  markitdown==0.1.6
  lightrag-hku==1.5.0
  markdown>=3.7
- python-docx>=1.1
- python-pptx>=0.6.23
- PyMuPDF>=1.24.0
  Pillow>=10.0.0
  sentence-transformers>=4.0.0
  optimum[onnxruntime]>=1.20.0
```

### 0.6 Docling structure.json Format Reference

Docling's `export_to_dict()` produces a tree like:

```json
{
  "name": "Document",
  "children": [
    {
      "label": "title",
      "text": "Annual Financial Report 2024",
      "children": []
    },
    {
      "label": "section_header",
      "level": 1,
      "text": "Chapter 1: Overview",
      "children": [
        { "label": "paragraph", "text": "This report presents..." },
        {
          "label": "table",
          "text": "| Metric | 2024 | 2023 |",
          "children": [...]
        },
        {
          "label": "section_header",
          "level": 2,
          "text": "1.1 Revenue Analysis",
          "children": [
            { "label": "paragraph", "text": "..." },
            { "label": "figure", "text": "Revenue chart", "image_ref": "..." }
          ]
        }
      ]
    }
  ]
}
```

Key node types:

| Label | Description | Fields |
|-------|-------------|--------|
| `section_header` | Heading | `level` (1-6), `text`, `children` |
| `paragraph` | Text block | `text` |
| `table` | Structured table | `text` (markdown), `children` (cells) |
| `figure` | Image/figure | `text` (caption), `image_ref` |
| `code` | Code block | `text` |
| `list` | Ordered/unordered list | `text`, `children` |

### 0.7 Image Manifest Format

`images/manifest.json` output:

```json
{
  "images": [
    {
      "ref": "figure_0",
      "filename": "img_000_abc12345.png",
      "path": "images/img_000_abc12345.png",
      "page": 12,
      "caption": "Revenue chart",
      "size": 15234
    }
  ],
  "count": 1
}
```

TS-side resolves Docling `image_ref` to file path via manifest lookup.

### 0.8 Acceptance Criteria

- [ ] Upload a PDF with multi-column layout → `structure.json` has correct reading order
- [ ] Upload a DOCX with heading styles → `structure.json` has `section_header` with correct `level` values
- [ ] Upload a PPTX → Docling produces markdown + structure (or falls back to MarkItDown)
- [ ] Upload an HTML file → Docling converts correctly
- [ ] Docling fails (e.g. corrupted file) → Falls back to MarkItDown, `structure` is `null`, `conversionMethod` is `"markitdown-fallback"`, `conversionWarning` contains reason
- [ ] Image manifest produced with `ref → filename → page` mapping
- [ ] `convertToMarkdown()` returns `ConversionResult` with valid `markdown` path
- [ ] `Document.conversionMethod` and `Document.conversionWarning` populated correctly
- [ ] Existing Path B pipeline (split → embed → index) works unchanged with new markdown output
- [ ] Python `docling` package installs without errors on Python 3.13

### 0.9 Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Docling is ~500MB with models | First upload slow | Pre-download models in setup script; MarkItDown fallback if models unavailable |
| Docling doesn't support some format | Conversion fails | Fallback to MarkItDown (existing code), `conversionMethod` surfaced to user |
| Docling API changes between versions | structure.json format shifts | Pin docling version in requirements.txt; write parser defensively |
| First-run model download exceeds timeout | Upload fails | Increase timeout to 10 min; add progress event for download status |

---

## Phase 1: Data Model

### Goal

Add `DomainDocument` model with stable identity (`stableDomainId`) and edit tracking. Add conversion metadata fields to `Document`.

### Files Changed

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Add `DomainDocument` model, add fields to `Document`, add relation to `User` |
| `src/types/documents.ts` | Add `DomainDocumentMeta`, `DomainClassification`, `DomainSplitResult`, `ImageManifest` types |

### 1.1 Prisma Schema

**DomainDocument** (new model):

```prisma
model DomainDocument {
  id              String   @id @default(cuid())
  stableDomainId  String   // content hash — survives re-processing
  documentId      String
  userId          String
  domain          String   // snake_case key: "financial_terms"
  domainLabel     String   // display label: "Financial Terminology" / "财务术语"
  title           String   // section heading or generated title
  content         String   // domain section text (truncated to budget at generation time)
  summary         String?  // LLM-generated summary
  headingPath     String?  // breadcrumb: "Chapter 3 > Section 3.2"
  tokenCount      Int      @default(0)
  index           Int      @default(0)  // global ordering
  sourcePages     String?  // JSON array: "[12,13,14]"
  isUserEdited    Boolean  @default(false)  // tracks if user modified content
  editCount       Int      @default(0)

  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user            User     @relation(fields: [userId], references: [id])

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([documentId])
  @@index([userId, domain])
  @@index([documentId, domain])
  @@index([userId, stableDomainId])
  @@index([documentId, stableDomainId])
}
```

**Document** (add fields):

```prisma
model Document {
  // ... existing fields ...
  domainDocuments   DomainDocument[]
  conversionMethod  String?   // "docling" | "markitdown" | "markitdown-fallback"
  conversionWarning String?
  domainCount       Int       @default(0)
}
```

**User** (add relation):

```prisma
model User {
  // ... existing fields ...
  domainDocuments DomainDocument[]
}
```

### 1.2 TypeScript Types

Add to `src/types/documents.ts`:

```typescript
export interface DomainDocumentMeta {
  id: string;
  stableDomainId: string;
  documentId: string;
  domain: string;
  domainLabel: string;
  title: string;
  content: string;
  summary: string | null;
  headingPath: string | null;
  tokenCount: number;
  index: number;
  sourcePages: string | null;
  isUserEdited: boolean;
  editCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DomainClassification {
  domains: {
    key: string;
    label: string;
    sectionIndices: number[];
    summary: string;
  }[];
}

export interface DomainSplitResult {
  domainDocs: DomainDocumentMeta[];
  error?: string;
}

export interface ImageManifest {
  images: {
    ref: string;
    filename: string;
    path: string;
    page: number | null;
    caption: string | null;
    size: number;
  }[];
  count: number;
}
```

### 1.3 Migration

```bash
npx prisma migrate dev --name add-domain-document-v1
```

### 1.4 Acceptance Criteria

- [ ] `DomainDocument` table created with all fields and indexes
- [ ] `Document.domainDocuments` relation works (cascade delete)
- [ ] `Document.conversionMethod`, `conversionWarning`, `domainCount` fields exist
- [ ] `DomainDocumentMeta` type matches Prisma model fields
- [ ] Existing tests pass after migration

---

## Phase 2: Domain Splitter

### Goal

Parse Docling's `structure.json` into structured sections, use a single LLM call to classify them into 2-6 domains AND generate summaries simultaneously, persist with stable identity, and inherit user edits across re-processing.

### v1.1 Changes from v1.0

| Aspect | v1.0 | v1.1 |
|--------|------|------|
| LLM calls for classify + summarize | 1 + N (one per domain) | **1 (merged)** |
| Domain identity | New CUID per re-process | **`stableDomainId` content hash** |
| Edit persistence | Lost on re-process | **Inherited via stableId matching** |
| Prompt | `domainClassify` + `domainSummary` | **`domainClassifyAndSummarize`** |

### Files Created

| File | Description |
|------|-------------|
| `src/lib/documents/docling-parser.ts` | Parse Docling structure.json → `DoclingSection[]`; resolve image refs via manifest |
| `src/lib/documents/domain-splitter.ts` | Single-call LLM classify+summarize, stableId generation, edit inheritance, persist |

### Files Modified

| File | Description |
|------|-------------|
| `src/lib/prompts/locales/en-prompts.ts` | Add `domainClassifyAndSummarize` prompt |
| `src/lib/prompts/locales/zh-CN-prompts.ts` | Add `domainClassifyAndSummarize` prompt |

### 2.1 Docling Parser

**File**: `src/lib/documents/docling-parser.ts`

```typescript
export interface DoclingSection {
  headingLevel: number;   // 1-6
  headingText: string;
  content: string;        // accumulated text under this heading
  headingPath: string;    // "Chapter 1 > Section 1.2"
  hasTable: boolean;
  hasImage: boolean;
  imageRefs: string[];    // image filenames (resolved via manifest)
  childCount: number;
}

// Main export
export function parseDoclingStructure(
  structureJson: unknown,
  imageManifest?: ImageManifest | null,
): DoclingSection[]

// Helper
export function resolveImageRef(
  doclingImageRef: string,
  manifest: ImageManifest,
): string | null
```

Algorithm:
1. Recursively traverse the Docling document tree
2. When encountering `section_header` nodes, start a new section
3. Collect all child content (paragraphs, tables, figures, code blocks) into the current section
4. Build `headingPath` by tracking the parent heading chain
5. For `figure` nodes, use `resolveImageRef()` to map `image_ref` to actual filename via manifest
6. Mark `hasTable` / `hasImage` flags based on child node types
7. Return flat array of `DoclingSection[]`

Edge cases:
- Document has no `section_header` nodes → single section with all content
- Deep nesting (H3-H6) → content accumulates under the nearest H1/H2 parent
- Empty sections (heading with no content) → skip
- Missing manifest → `imageRefs` stays empty, `hasImage` still true (from `figure` node detection)

### 2.2 Domain Splitter

**File**: `src/lib/documents/domain-splitter.ts`

#### Main Function Signature

```typescript
export async function splitIntoDomains(
  markdown: string,
  structurePath: string | null,
  imageManifestPath: string | null,
  documentId: string,
  userId: string,
  writingModel: ModelWithProvider | null,
): Promise<DomainSplitResult>
```

#### Algorithm

```
1. Parse sections
   IF structurePath exists AND file is valid:
     manifest = loadManifest(imageManifestPath)
     sections = parseDoclingStructure(JSON.parse(file), manifest)
   ELSE:
     sections = fallbackMacroSplit(markdown)

2. Short-circuit: if sections.length <= 2
     → single domain, no LLM call
     → summary = first 300 chars of content
     → persist with stableId and return

3. Fallback: if no writingModel
     → group by H1 heading (no LLM)
     → summary = first 150 chars per chunk
     → persist with stableId and return

4. Build section previews
   For each section: index, headingLevel, headingText, headingPath, charCount, preview (first 200 chars)
   Total preview tokens capped at ~4000

5. LLM call: classifyAndSummarize(previews, writingModel)     ← SINGLE CALL
   System prompt: domainClassifyAndSummarize
   Output: { domains: [{ key, label, sectionIndices, summary }] }

6. Group sections by domain
   Validate sectionIndices are in bounds
   Skip domains with 0 valid sections

7. Persist with edit inheritance
   a. Query old records where isUserEdited = true
   b. Build editMap indexed by stableDomainId
   c. For each new domain group:
      - Compute stableDomainId from documentId + headingPath + content prefix
      - If old edit exists for this stableId → inherit content/summary
      - Set isUserEdited flag accordingly
   d. Atomic replace: deleteMany + createMany in transaction
```

#### `stableDomainId` Generation

```typescript
import { createHash } from "crypto";

function generateStableDomainId(
  documentId: string,
  headingPath: string | null,
  contentPreview: string,
): string {
  const normalizedPath = (headingPath || "root").toLowerCase().trim();
  const normalizedContent = contentPreview
    .slice(0, 500)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  
  return createHash("sha256")
    .update(`${documentId}:${normalizedPath}:${normalizedContent}`)
    .digest("hex")
    .slice(0, 16);
}
```

Logic: same document + same heading path + same first 500 chars of content → same stableId. User edits to later content don't change the hash.

#### Edit Inheritance in `persistDomainDocuments()`

```typescript
async function persistDomainDocuments(
  groups: DomainGroup[],
  documentId: string,
  userId: string,
): Promise<DomainDocumentMeta[]> {
  // 1. Find user-edited records from previous processing
  const oldEdited = await prisma.domainDocument.findMany({
    where: { documentId, isUserEdited: true },
    select: { stableDomainId: true, content: true, summary: true },
  });
  const editMap = new Map(oldEdited.map(d => [d.stableDomainId, d]));

  // 2. Build new records with edit inheritance
  const records = [];
  let globalIndex = 0;

  for (const group of groups) {
    const content = group.sections.map(s => s.content).join("\n\n");
    const stableId = generateStableDomainId(
      documentId,
      group.sections[0]?.headingPath || null,
      content.slice(0, 500),
    );
    
    const oldEdit = editMap.get(stableId);
    
    for (const section of group.sections) {
      records.push({
        stableDomainId: stableId,
        documentId,
        userId,
        domain: group.domain,
        domainLabel: group.domainLabel,
        title: section.headingText,
        content: oldEdit?.content ?? section.content,
        summary: oldEdit?.summary ?? group.summary,
        headingPath: section.headingPath,
        tokenCount: section.tokenCount ?? estimateTokens(section.content),
        index: globalIndex++,
        isUserEdited: !!oldEdit,
        editCount: oldEdit ? 1 : 0,
      });
    }
  }

  // 3. Atomic replace
  await prisma.$transaction([
    prisma.domainDocument.deleteMany({ where: { documentId } }),
    prisma.domainDocument.createMany({ data: records }),
  ]);

  return records; // map to DomainDocumentMeta[]
}
```

### 2.3 Prompt: `domainClassifyAndSummarize`

#### English

```
You are a document domain analyst. Given a list of document sections with their
headings and content previews, classify them into 2-6 thematic domains and generate
a concise summary for each domain.

Rules:
- Produce 2-6 domains (no more, no less)
- Domain keys must be lowercase snake_case English (e.g. "financial_analysis")
- Domain labels must be in the SAME LANGUAGE as the document content
- Adjacent sections about related topics should share a domain
- Each section must appear in exactly one domain
- A domain should ideally contain 2+ sections unless the document is short
- Summaries must be 100-200 characters, capturing key topics and methodologies
- Do NOT add information not present in the source

Output JSON:
{
  "domains": [
    {
      "key": "snake_case_key",
      "label": "Human Readable Label",
      "sectionIndices": [0, 1, 2],
      "summary": "Concise summary of what this domain covers."
    }
  ]
}
```

#### Chinese

```
你是一个文档领域分析专家。给定文档的章节列表（包含标题和内容预览），
请将它们分类到 2-6 个主题领域中，并为每个领域生成摘要。

规则:
- 产生 2-6 个领域（不要多也不要少）
- 领域键名必须是小写英文字母+下划线（如 "financial_analysis"）
- 领域标签必须与文档内容使用相同语言
- 相邻且主题相关的章节应归入同一领域
- 每个章节只能出现在一个领域中
- 一个领域最好包含 2 个以上章节，除非文档很短
- 摘要长度 100-200 字，概括关键主题和方法论
- 不要添加原文中没有的信息

输出 JSON:
{
  "domains": [
    {
      "key": "snake_case_key",
      "label": "人类可读的标签",
      "sectionIndices": [0, 1, 2],
      "summary": "该领域所涵盖内容的简洁摘要。"
    }
  ]
}
```

### 2.4 Acceptance Criteria

- [ ] Parse Docling structure.json with nested section_headers → correct heading levels and paths
- [ ] Parse Docling structure.json with no section_headers → single section
- [ ] Invalid structure.json → fallback to macro-split regex
- [ ] Image refs resolved via manifest → correct filenames in `imageRefs`
- [ ] Image manifest missing → `imageRefs` empty, `hasImage` still detected
- [ ] 3-section document → single domain, no LLM call
- [ ] 10-section document with writing model → **single LLM call** returns 2-6 domains with summaries
- [ ] 10-section document without writing model → grouped by H1
- [ ] Each domain has a summary (100-200 chars) from the same LLM call
- [ ] `stableDomainId` is deterministic: same input → same hash
- [ ] Re-process same document → old user edits preserved via stableId matching
- [ ] Re-process same document with changed content → stableId changes, old edits not inherited (correct)
- [ ] DomainDocument records created in DB with correct fields
- [ ] LLM returns invalid JSON → error caught, function returns `{ error }`, does not throw
- [ ] LLM returns sectionIndices out of bounds → invalid indices skipped

---

## Phase 3: Parallel Pipeline

### Goal

Modify `document-worker.ts` to fork into Path A and Path B after document conversion, running both in parallel. Update `domainCount` on completion.

### Files Modified

| File | Description |
|------|-------------|
| `src/lib/queue/workers/document-worker.ts` | Add `Promise.allSettled` fork, update `domainCount` |

### 3.1 New Flow

```
processDocument():
  1. status=running (10%)           ← unchanged
  2. loadProcessingTask()            ← unchanged
  3. supersede check #1              ← unchanged
  4. status=converting               ← unchanged
  5. convertDocument()               ← Phase 0: now sets ctx.structurePath, conversionMethod
  6. resolveProcessingModels()       ← unchanged
  7. status=splitting

  8. ─── Promise.allSettled ───
     Path A: splitIntoDomains(       ← Phase 2
       markdown, ctx.structurePath,
       ctx.imageManifestPath,        ← NEW
       ctx.docId, ctx.doc.userId,
       ctx.writingModel
     )

     Path B:                         ← existing code, moved into closure
       a. calculateSplitPlan()
       b. persist metadata
       c. splitAndPersistChunks()
       d. supersede check #2
       e. embedDocumentChunks()
       f. supersede check #3
       g. indexDocument()

  9. ─── JOIN ───
     Path A rejected/failed → console.warn, continue
     Path B rejected/failed → throw (existing behavior)
     Path A succeeded → update document.domainCount

  10. autoTagDocument()              ← unchanged
  11. status=ready (→100%)           ← unchanged
```

### 3.2 Key Implementation

```typescript
const markdown = /* from convertDocument */;
const [pathAResult, pathBResult] = await Promise.allSettled([

  // Path A: Domain splitting
  (async () => {
    try {
      const result = await splitIntoDomains(
        markdown,
        ctx.structurePath,
        ctx.imageManifestPath,
        ctx.docId,
        ctx.doc.userId,
        ctx.writingModel,
      );
      return { ok: true, domainCount: result.domainDocs.length };
    } catch (err) {
      console.warn("[Path A] Domain splitting failed (non-blocking):", err);
      return { ok: false, error: String(err) };
    }
  })(),

  // Path B: Existing RAG pipeline (code moved verbatim)
  (async () => {
    const plan = calculateSplitPlan(ctx, markdown);
    await db.document.update({ ... });
    await splitAndPersistChunks(ctx, markdown, plan, storage);
    await assertLatestDocumentConvertTask(...);
    onProgress(80);
    if (ctx.embedModel && ctx.options.indexTarget !== "original") {
      await embedDocumentChunks(ctx);
    }
    await assertLatestDocumentConvertTask(...);
    onProgress(85);
    const initialMode = getInitialIndexMode(ctx.options);
    await indexDocument(ctx, initialMode);
    onProgress(92);
    return { ok: true };
  })(),
]);

// Evaluate
if (pathAResult.status === "fulfilled" && pathAResult.value.ok) {
  const count = pathAResult.value.domainCount;
  await db.document.update({
    where: { id: ctx.docId },
    data: { domainCount: count },
  });
  console.log(`[Path A] Created ${count} domain documents`);
} else {
  console.warn("[Path A] Skipped:", ...);
}

if (pathBResult.status === "rejected") {
  throw pathBResult.reason;
}
```

### 3.3 Progress Bar

No change. Path B is the long pole (20-150s). Path A finishes in 3-8s and never adds to total time.

| Stage | Progress | Source |
|-------|----------|--------|
| Start | 10% | Unchanged |
| Converting | 40% | Unchanged |
| Splitting | 60% | Path B split done |
| Embedding | 80% | Path B embed done |
| Indexing | 85-92% | Path B index done |
| Auto-tag | 95% | Adjusted from 92% |
| Ready | 100% | Unchanged |

### 3.4 Acceptance Criteria

- [ ] Upload document → Path A creates DomainDocument records, Path B creates DocumentChunk records
- [ ] Path A throws error → Path B completes, document status = "ready", no DomainDocument records
- [ ] Path B throws error → document status = "failed"
- [ ] Both paths fail → document status = "failed" (Path B error thrown)
- [ ] `document.domainCount` updated correctly after Path A success
- [ ] Progress bar updates correctly (same percentages as before)
- [ ] Supersede checks still work (cancel during Path B embed/index)
- [ ] Graph index follow-up task still enqueued after completion

---

## Phase 4: Generation Context

### Goal

When generating a section, add a domain selection step before RAG retrieval. Domain docs are placed **before** RAG in the prompt. Selection uses two-stage filtering (keyword pre-filter → LLM fine-select).

### v1.1 Changes from v1.0

| Aspect | v1.0 | v1.1 |
|--------|------|------|
| Prompt block order | Domain after RAG | **Domain before RAG** |
| Domain selection | Load all → send all to LLM | **Keyword pre-filter (Top-20) → LLM fine-select (Top-4)** |
| Select file location | Inline in generator.ts | **Separate `select-domain.ts`** |

### Files Modified

| File | Description |
|------|-------------|
| `src/lib/writing/generator.ts` | Add `selectDomainDocuments()` call, pass results to `assembleContext()` |
| `src/lib/writing/context.ts` | Add `domainDocuments` to `ContextInput`, add `buildDomainDocumentsSection()`, place **before** RAG |
| `src/lib/prompts/locales/en-prompts.ts` | Add `domainSelect` prompt |
| `src/lib/prompts/locales/zh-CN-prompts.ts` | Add `domainSelect` prompt |

### Files Created

| File | Description |
|------|-------------|
| `src/lib/writing/select-domain.ts` | Two-stage domain selection logic |

### 4.1 Modified `generateSectionFull()` Flow

```
1. Resolve LLM model                   (existing)
2. enrichSectionContext()               (existing — generates retrieval query)
3. selectDomainDocuments()              ← NEW: two-stage selection
4. fetchRagReferences()                 (existing — semantic search)
5. Build effective constraints          (existing)
6. assembleContext({                    (modified)
     ...existing,
     domainDocuments: domainDocs        ← placed BEFORE RAG in prompt
   })
7. LLM chat call                        (existing)
8. Record token usage                   (existing)
9. Return { ..., domainDocuments }      (modified)
```

### 4.2 Two-Stage Domain Selection

**File**: `src/lib/writing/select-domain.ts`

```typescript
export async function selectDomainDocuments(
  draftTitle: string,
  section: { title: string; description?: string | null; keyPoints?: string | null },
  userId: string,
  provider: any,
  modelId: string,
  ragDocumentIds?: string[],
): Promise<DomainDocumentMeta[]>
```

**Stage 1: Keyword pre-filter (zero-cost)**

```typescript
// Build query text from section metadata
const queryText = `${draftTitle} ${section.title} ${section.description || ""} ${section.keyPoints || ""}`;

// Load candidates (capped at 100)
const candidates = await prisma.domainDocument.findMany({
  where: {
    userId,
    ...(ragDocumentIds?.length ? { documentId: { in: ragDocumentIds } } : {}),
  },
  take: 100,
});

if (candidates.length === 0) return [];
if (candidates.length <= 8) {
  // Few candidates — skip pre-filter, go directly to LLM
  return fineSelect(candidates, queryText, provider, modelId);
}

// Simple keyword overlap scoring (works for both EN and CN)
const queryLower = queryText.toLowerCase();
const scored = candidates.map(c => {
  const text = `${c.domainLabel} ${c.title} ${c.summary || ""}`.toLowerCase();
  let score = 0;
  // Split query into chunks (works for Chinese chars and English words)
  const chunks = queryLower.split(/[\s,，。.、；;：:！!？?]+/).filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.length >= 2 && text.includes(chunk)) score++;
  }
  return { ...c, _score: score };
});

// Take Top-20 for LLM
const topCandidates = scored
  .sort((a, b) => b._score - a._score)
  .slice(0, 20)
  .map(({ _score, ...rest }) => rest);
```

**Stage 2: LLM fine-select (max 20 candidates)**

```typescript
async function fineSelect(
  candidates: DomainDocumentMeta[],
  queryText: string,
  provider: any,
  modelId: string,
): Promise<DomainDocumentMeta[]> {
  const compactIndex = candidates.map(c => ({
    id: c.id,
    domain: c.domainLabel,
    title: c.title,
    summary: (c.summary || "").slice(0, 150),
    tokens: c.tokenCount,
  }));

  const systemPrompt = getPrompt("domainSelect", "zh-CN");

  const response = await provider.chat({
    modelId,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Query: ${queryText}\n\nAvailable domains:\n${JSON.stringify(compactIndex, null, 2)}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  try {
    const parsed = JSON.parse(response.content);
    const selectedIds = new Set((parsed.selectedIds || []).filter(
      (id: string) => candidates.some(c => c.id === id)
    ));
    return candidates.filter(c => selectedIds.has(c.id)).slice(0, 4);
  } catch {
    return []; // non-blocking: fallback to RAG-only
  }
}
```

### 4.3 `domainSelect` Prompt

#### English

```
You are selecting the most relevant domain knowledge documents for writing a specific
section of a document.

Given:
1. The draft title and section being written
2. A list of available domain documents (with ID, domain label, title, and summary)

Select 0-4 domain document IDs that are most relevant to the section being written.
Prioritize:
- Directly related topics (same domain)
- Foundational/contextual knowledge the section depends on
- Methodologies or frameworks mentioned in the section description

Do NOT select documents that are tangentially related. It's better to select 0-2
highly relevant ones than 4 marginally related ones.

Output JSON:
{ "selectedIds": ["id1", "id2"] }

If no domain documents are relevant, output: { "selectedIds": [] }
```

#### Chinese

```
你正在为撰写文档的特定章节选择最相关的领域知识文档。

给定:
1. 草稿标题和正在撰写的章节信息
2. 可用的领域文档列表（含ID、领域标签、标题和摘要）

请选择 0-4 个与当前章节最相关的领域文档ID。优先选择:
- 直接相关的主题（同领域）
- 章节依赖的基础/背景知识
- 章节描述中提到的方法论或框架

不要选择仅有边缘关联的文档。选择 0-2 个高度相关的比选 4 个勉强相关的更好。

输出 JSON:
{ "selectedIds": ["id1", "id2"] }

如果没有相关文档，输出: { "selectedIds": [] }
```

### 4.4 Modified `assembleContext()` — Prompt Block Order

**v1.1 block order** (domain docs BEFORE RAG):

```
1. Outline summary
2. Completed section summaries
3. Domain Knowledge Base         ← BEFORE RAG
4. RAG References                ← AFTER domain docs
5. Target section spec
6. Constraints
7. Instruction
```

`ContextInput` interface:

```typescript
interface ContextInput {
  draft: { title: string; outline: string; description?: string };
  section: { title: string; description?: string; keyPoints?: string; estimatedWords?: number };
  completedSections: { title: string; summary: string; status: string }[];
  ragReferences: ContextInput["ragReferences"];
  constraints?: { ... };
  domainDocuments?: DomainDocumentMeta[];
}
```

`buildDomainDocumentsSection()`:

```typescript
const DOMAIN_DOC_TOTAL_CHAR_LIMIT = 8000;
const DOMAIN_DOC_PER_CHAR_LIMIT = 4000;

function buildDomainDocumentsSection(
  domainDocs: DomainDocumentMeta[] | undefined,
): string {
  if (!domainDocs || domainDocs.length === 0) return "";

  let totalChars = 0;
  const parts: string[] = [];

  const byDomain = new Map<string, DomainDocumentMeta[]>();
  for (const doc of domainDocs) {
    if (!byDomain.has(doc.domain)) byDomain.set(doc.domain, []);
    byDomain.get(doc.domain)!.push(doc);
  }

  for (const [domain, docs] of byDomain) {
    for (const doc of docs) {
      const budget = Math.min(
        DOMAIN_DOC_PER_CHAR_LIMIT,
        DOMAIN_DOC_TOTAL_CHAR_LIMIT - totalChars,
      );
      if (budget <= 0) break;

      const content = doc.content.slice(0, budget);
      const header = `### ${doc.domainLabel} — ${doc.title}`;
      const source = doc.headingPath ? `> Source: ${doc.headingPath}` : "";

      const block = [
        header,
        source,
        "",
        content,
      ].filter(Boolean).join("\n");

      parts.push(block);
      totalChars += block.length;
    }
    if (totalChars >= DOMAIN_DOC_TOTAL_CHAR_LIMIT) break;
  }

  return [
    "## Domain Knowledge Base",
    "",
    "The following domain-specific documents are the PRIMARY reference for this section.",
    "Use them before consulting the RAG references below. If there is a conflict between",
    "Domain Knowledge and RAG snippets, prioritize Domain Knowledge.",
    "",
    ...parts.join("\n\n---\n\n"),
  ].join("\n");
}
```

`assembleContext()` insertion point:

```typescript
// a. Outline summary (unchanged)
// b. Completed section summaries (unchanged)

// c. Domain docs — BEFORE RAG
const domainSection = buildDomainDocumentsSection(input.domainDocuments);
if (domainSection) userParts.push(domainSection);

// d. RAG references (unchanged, now after domain docs)
const ragSection = buildRagReferencesSection(...);
if (ragSection) userParts.push(ragSection);

// e. Target section (unchanged)
// f. Constraints (unchanged)
// g. Instruction (unchanged)
```

### 4.5 Latency Impact

- Keyword pre-filter: ~0.01s (in-memory string matching)
- DB query (capped at 100): ~0.1s
- LLM fine-select (max 20 candidates): ~2-5s
- Content assembly: ~0.01s
- **Total overhead per section: ~2-5s** (3-7% of total generation time)

### 4.6 Acceptance Criteria

- [ ] Section generation with domain docs available → prompt contains domain docs section **before** RAG section
- [ ] Section generation with no domain docs → prompt unchanged from current behavior
- [ ] Domain selection returns 0-4 IDs
- [ ] Domain selection returns empty array for unrelated sections
- [ ] Pre-filter reduces candidates to <= 20 before LLM call
- [ ] When candidates <= 8, pre-filter is skipped (directly to LLM)
- [ ] Domain docs in prompt respect 8000 char total budget
- [ ] Single domain doc exceeding 4000 chars is truncated
- [ ] LLM returns invalid JSON → fallback to empty domain docs, generation still succeeds
- [ ] `ragMode === "manual"` → only domain docs from specified documents are considered
- [ ] `ragMode === "off"` → domain docs still selected (independent of RAG mode)
- [ ] `FullGenerationResult` includes `domainDocuments` field

---

## Phase 5: Library UI

### Goal

Add a "Domain Documents" tab to the Library page for browsing and editing domain documents. Show conversion method badges and edit indicators.

### Files Created

| File | Description |
|------|-------------|
| `src/app/api/v1/library/domains/route.ts` | GET: list domain documents |
| `src/app/api/v1/library/domains/[id]/route.ts` | GET: single, PUT: update |
| `src/app/api/v1/library/domains/index/route.ts` | GET: list distinct domains |
| `src/components/library/domain-document-list.tsx` | Domain doc cards grouped by domain |
| `src/components/library/domain-document-edit-modal.tsx` | Edit content/summary modal |

### Files Modified

| File | Description |
|------|-------------|
| `src/app/(dashboard)/library/page.tsx` | Add tab state, render domain tab |
| `src/components/library/document-table.tsx` | Add conversion method badge to document rows |

### 5.1 API Endpoints

#### `GET /api/v1/library/domains`

Query params: `domain?`, `documentId?`, `page?` (default 1), `limit?` (default 50)

Response:
```json
{
  "success": true,
  "data": [DomainDocumentMeta],
  "total": 42,
  "page": 1,
  "limit": 50
}
```

#### `GET /api/v1/library/domains/[id]`

Response includes `documentName` from joined Document table.

#### `PUT /api/v1/library/domains/[id]`

Body:
```json
{
  "content": "...",
  "summary": "..."
}
```

On save, sets `isUserEdited = true` and increments `editCount`.

#### `GET /api/v1/library/domains/index`

Response:
```json
{
  "success": true,
  "data": [
    { "domain": "financial_analysis", "domainLabel": "财务分析", "count": 5 },
    { "domain": "methodology", "domainLabel": "方法论", "count": 3 }
  ]
}
```

### 5.2 Library Page Tab Structure

```tsx
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList>
    <TabsTrigger value="documents">Documents</TabsTrigger>
    <TabsTrigger value="domains">
      Domain Knowledge
      {domainCount > 0 && <Badge>{domainCount}</Badge>}
    </TabsTrigger>
  </TabsList>

  <TabsContent value="documents">
    {/* Existing Stats ribbon + Document table */}
    {/* Document rows show conversionMethod badge: docling=green, fallback=amber */}
  </TabsContent>

  <TabsContent value="domains">
    <DomainDocumentList userId={session.user.id} />
  </TabsContent>
</Tabs>
```

### 5.3 DomainDocumentList Component

Layout:
```
┌──────────────────────────────────────────────────┐
│ [Domain ▾]  [Source Doc ▾]  [🔍 Search]         │
├──────────────────────────────────────────────────┤
│ 📁 Financial Analysis (5)                        │
│ ┌────────────────────────────────────────────┐   │
│ │ Chapter 3: Financial Statements           │   │
│ │ Summary preview (150 chars)...             │   │
│ │ 1,234 tokens · Source: annual_report.pdf   │   │
│ │ ✏️ Edited    [Edit] [View]                  │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ 📁 Methodology (3)                               │
│ ┌────────────────────────────────────────────┐   │
│ │ ...                                        │   │
│ └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

Features:
- Fetches from `GET /api/v1/library/domains`
- Groups by `domain` (collapsible sections)
- Filters: domain dropdown, source document dropdown
- Each card: title, summary preview, token count, source document name
- `isUserEdited` indicator (pencil icon)
- Edit button → opens `DomainDocumentEditModal`
- View button → expand card to show full content
- If source document has `conversionMethod === "markitdown-fallback"` → show warning notice

### 5.4 DomainDocumentEditModal

```
┌──────────────────────────────────────────────┐
│ Edit Domain Document                    [✕]   │
├──────────────────────────────────────────────┤
│ Domain: Financial Analysis                    │
│ Path: Chapter 3 > Section 3.2                │
│ Source: annual_report.pdf                     │
│                                              │
│ Summary:                                     │
│ ┌──────────────────────────────────────────┐ │
│ │ [editable textarea]                      │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Content:                                     │
│ ┌──────────────────────────────────────────┐ │
│ │ [editable textarea, monospace]           │ │
│ │ [large, scrollable]                      │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│                    [Cancel]  [Save]           │
└──────────────────────────────────────────────┘
```

Save calls `PUT /api/v1/library/domains/[id]`. Sets `isUserEdited = true` server-side.

### 5.5 Conversion Method Badge

On document table rows:
- `docling` → green dot + "Docling" tooltip
- `markitdown-fallback` → amber dot + warning icon + tooltip with `conversionWarning`
- `markitdown` (direct) → gray dot + "MarkItDown"

### 5.6 Acceptance Criteria

- [ ] Library page shows two tabs: Documents and Domain Knowledge
- [ ] Domain tab shows domain documents grouped by domain
- [ ] Domain filter dropdown shows all distinct domains
- [ ] Source document filter dropdown shows source document names
- [ ] Edit modal opens, allows editing content and summary
- [ ] Save persists changes via PUT API, sets `isUserEdited = true`
- [ ] Edited domain docs show pencil icon indicator
- [ ] Fallback documents show warning notice in domain tab
- [ ] Document table shows conversion method badge
- [ ] No domain documents → empty state message
- [ ] Loading state while fetching
- [ ] Domain count badge on tab updates after document processing

---

## Phase 6: Reference Display

### Goal

Record which domain documents were used during generation and display them alongside existing RAG references.

### Files Modified

| File | Description |
|------|-------------|
| `src/lib/writing/generator.ts` | Save domain doc references to SectionReference table after generation |

### 6.1 Implementation

In `generateSectionFull()`, after the LLM call succeeds and before returning:

```typescript
if (domainDocs.length > 0) {
  await prisma.sectionReference.createMany({
    data: domainDocs.map(d => ({
      sectionId: section.id,
      documentId: d.documentId,
      documentName: `[Domain] ${d.domainLabel} — ${d.title}`,
      relevanceScore: 1.0,
      sourceAnchor: d.headingPath || undefined,
      content: d.summary || d.content.slice(0, 500),
    })),
  });
}
```

### 6.2 UI Display

The existing `SectionReference` component already renders all references. Domain doc references appear with `[Domain]` prefix, naturally distinguishing them from RAG chunk references.

### 6.3 Acceptance Criteria

- [ ] After generation with domain docs → SectionReference records created with `[Domain]` prefix
- [ ] Reference list shows domain references alongside RAG references
- [ ] `relevanceScore` is 1.0 for domain references (LLM-selected)
- [ ] `sourceAnchor` contains headingPath
- [ ] Generation with no domain docs → no domain SectionReference records
- [ ] Re-generation of same section → old domain references replaced

---

## Phase 7: Testing

### 7.1 Unit Tests

**File**: `src/lib/documents/__tests__/docling-parser.test.ts`

| Case | Input | Expected |
|------|-------|----------|
| Valid structure with 3 levels of headings | Nested section_header JSON | 5+ DoclingSections with correct headingPath |
| No section_headers | Only paragraph nodes | Single section with all content |
| Empty structure | `{ children: [] }` | Empty array |
| Table inside section | section_header + table child | `hasTable: true` |
| Figure with manifest | section_header + figure child + manifest | `hasImage: true, imageRefs: ["img_000_abc.png"]` |
| Figure without manifest | section_header + figure child, null manifest | `hasImage: true, imageRefs: []` |
| Deep nesting (H3 under H2 under H1) | 3-level hierarchy | headingPath = "H1 > H2 > H3" |

**File**: `src/lib/documents/__tests__/domain-splitter.test.ts`

| Case | Input | Expected |
|------|-------|----------|
| Small document (2 sections) | 2 DoclingSections | Single domain, no LLM call |
| No writing model | 10 sections, null model | Grouped by H1, no LLM call |
| Normal classify+summarize | 10 sections, mock LLM | Single LLM call, 3 domains with summaries |
| LLM returns invalid JSON | Mock LLM returning "not json" | Returns `{ error }`, no throw |
| LLM returns out-of-bounds indices | Mock LLM returning `[99]` | Invalid indices skipped |
| stableId deterministic | Same input twice | Same stableDomainId |
| stableId changes on content change | Different first-500-chars | Different stableDomainId |
| Edit inheritance | Old edited record + new process | New record inherits old content/summary |
| Edit not inherited on content change | Old edited + changed content prefix | New stableId, no inheritance |

**File**: `src/lib/writing/__tests__/select-domain.test.ts`

| Case | Input | Expected |
|------|-------|----------|
| 0 candidates | Empty DB | Returns `[]` |
| 5 candidates | Few enough to skip pre-filter | Directly to LLM |
| 50 candidates with keyword overlap | Query matches 3/50 | Pre-filter sends <= 20 to LLM |
| LLM returns invalid JSON | Mock LLM failure | Returns `[]`, no throw |
| LLM selects invalid IDs | Mock LLM returning `["fake-id"]` | Returns `[]` (filtered by valid IDs) |

### 7.2 Integration Tests

| Scenario | Steps | Verify |
|----------|-------|--------|
| Full pipeline happy path | Upload PDF → wait for ready | DomainDocument + DocumentChunk records created, `domainCount > 0` |
| Full pipeline with Docling fallback | Upload unsupported format → fallback | `conversionMethod = "markitdown-fallback"`, `structure = null`, Path A uses macro-split fallback |
| Path A failure | Mock splitIntoDomains to throw | Document still reaches "ready", no DomainDocument records |
| Path B failure | Mock embedDocumentChunks to throw | Document status = "failed" |
| Generation with domains | Generate section on draft with domain docs | Prompt contains domain docs **before** RAG, response includes domainDocuments |
| Generation without domains | Generate section on draft with no domain docs | Prompt has no domain docs block |
| Edit domain doc | PUT updated content → generate section | New content appears in generated output |
| Re-process preserves edits | Edit domain doc → reprocess document | Edited domain doc retains user content |

### 7.3 Manual Test Checklist

- [ ] Upload Chinese PDF (50+ pages) → Check domain classification quality (2-6 domains, Chinese labels)
- [ ] Upload English DOCX → Check domain labels are in English
- [ ] Upload single-page document → Single domain, no LLM classification call
- [ ] Upload file that triggers MarkItDown fallback → Warning badge visible in Library
- [ ] Library → Domain tab → All domains visible, grouped correctly
- [ ] Library → Domain tab → Edit a domain doc → Save → Verify updated content in DB
- [ ] Library → Domain tab → Reprocess source document → Edited domain doc content preserved
- [ ] Generate section → Check reference list shows `[Domain]` prefixed references
- [ ] Generate section → Check prompt in logs has "Domain Knowledge Base" section BEFORE RAG section
- [ ] Delete source document → Domain documents cascade deleted

---

## Dependency Graph

```
Phase 0 (Docling) ──────┐
                         │
Phase 1 (Data Model) ───┤─── independent of Phase 0
                         │
                         ▼
Phase 2 (Domain Splitter) ── depends on Phase 0 + Phase 1
                         │
                         ▼
Phase 3 (Parallel Pipeline) ── depends on Phase 2
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
Phase 4 (Context)  Phase 5 (UI)   Phase 6 (Refs)
   depends on P1     depends on P1   depends on P4
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                  Phase 7 (Testing)
```

## Estimated Effort

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| 0. Docling Integration | 3.5h | None |
| 1. Data Model | 1h | None |
| 2. Domain Splitter | 3h | Phase 0, 1 |
| 3. Parallel Pipeline | 1.5h | Phase 2 |
| 4. Generation Context | 4h | Phase 1 |
| 5. Library UI | 3.5h | Phase 1 |
| 6. Reference Display | 1h | Phase 4 |
| 7. Testing | 4h | All |
| **Total** | **~21.5h** | |

Critical path: Phase 0 → 1 → 2 → 3 → 4 → 6 → 7

Parallel opportunity: Phase 5 (UI) can start after Phase 1, independent of Phases 2-4.

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Docling model download fails on user machine | Medium | High (blocks conversion) | MarkItDown fallback + visible `conversionMethod` badge so user knows |
| Docling doesn't support a user's file format | Low | Medium (structure.json = null) | Fallback to MarkItDown + macro-split regex for Path A |
| LLM domain classification produces inconsistent results | Medium | Medium (domains vary) | Temperature 0.2; stableId inherits user edits; user can edit domains |
| LLM domain selection picks wrong docs | Low | Medium (noise in prompt) | Pre-filter reduces noise; returns 0-4; user can edit/trim domains |
| Prompt budget exceeded with domain docs + RAG | Low | Medium (truncated content) | Hard limits (8000 domain + 12000 RAG); domain first, RAG truncated after |
| stableDomainId collision (different content, same hash) | Very Low | Low (wrong edit inherited) | 16-char hex prefix of SHA256 — collision probability negligible |
| SQLite performance with DomainDocument table | Low | Low (small volume) | 2-20 records per document; batch createMany; take: 100 limit on queries |
| structure.json format changes in Docling update | Low | Medium (parser breaks) | Pin docling version; defensive parsing; fallback to macro-split |

---

## Appendix A: Changes from v1.0

| # | Change | Phase Affected | Rationale |
|---|--------|---------------|-----------|
| 1 | Merged classify + summarize into single LLM call | Phase 2 | Reduces API calls from 1+N to 1; marginal cost near zero; latency halved |
| 2 | Added `stableDomainId` + edit inheritance | Phase 1, 2 | User edits survive re-processing; prevents data loss frustration |
| 3 | Moved domain docs before RAG in prompt | Phase 4 | Avoids "lost in the middle" attention decay; aligns position with priority |
| 4 | Added keyword pre-filter before LLM selection | Phase 4 | Reduces LLM input noise ~90%; zero-cost string matching |
| 5 | Added `images/manifest.json` for ref→file mapping | Phase 0 | TS-side can reliably associate Docling image_ref with actual files |
| 6 | Added `conversionMethod` + UI badges | Phase 0, 5 | User visibility into parsing quality; builds trust |
| 7 | Did NOT adopt sub-chunking + fullContent | — | YAGNI: current implementation equivalent to truncation; defer to future |

## Appendix B: Deferred to Future Iteration

1. **Intelligent sub-chunk selection** — Use vector similarity to pick the most relevant sub-chunk from a long domain instead of always taking the first
2. **Domain dependency graph** — Allow LLM to output `dependencies` between domains; auto-include related domain summaries
3. **Domain quality scoring** — Track user edit/acceptance rates to evaluate domain classification quality over time
4. **Cross-document domain merging** — If multiple documents share the same domain key, merge into a global knowledge base
5. **Image understanding via VLM** — Pass extracted images through a vision model to generate text descriptions for domain content
6. **Docling integration** (when stable) — Upgrade from MarkItDown fallback to Docling-only conversion
