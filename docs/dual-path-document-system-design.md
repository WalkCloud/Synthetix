# Dual-Path Document System Design

## Overview

### Problem

Current document processing pipeline is a single-path RAG flow: documents are converted to markdown, chunked by regex-based heading parsing, embedded into vectors, and retrieved via semantic search during writing generation. This has fundamental limitations:

1. **Chunking is mechanical** — `splitByMacroAST()` uses regex `/^(#{1,6})\s+(.+)/` to guess heading levels. PDF multi-column layouts produce garbled text, DOCX without heading styles produce flat content, tables get fragmented.
2. **RAG retrieval is fragmented** — Each chunk is 512-1536 tokens. When writing a section that needs systematic knowledge of an entire domain (e.g. "financial analysis methodology"), 8 independent chunks cannot match a complete domain document.
3. **Images are discarded** — `sanitize.ts` converts `![alt](images/xxx.png)` to `[Image: alt]`. Images cannot be vectorized or retrieved.
4. **No domain awareness** — The system treats all chunks equally. It doesn't understand that some chunks belong to the same thematic domain.

### Solution

Introduce a dual-path architecture that runs in parallel after document conversion:

- **Path A (Domain Documents)** — Uses Docling for high-quality document structure extraction, then LLM classifies content into 2-6 thematic domains. Each domain is stored as a complete, structured document with summary. During generation, an LLM selects relevant domains first, then the full domain content is injected into the prompt.

- **Path B (RAG Chunks)** — The existing pipeline continues unchanged: sanitize → macro-split → micro-split → embed → index. Semantic search retrieves top-K chunks as supplementary references.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Document converter | Docling (primary) + MarkItDown (fallback) | Docling provides precise heading hierarchy, table structure, image references, and reading order that regex parsing cannot achieve |
| Domain count | 2-6 per document | LLM-instructed. Balanced granularity — enough to be useful, not so many that selection becomes noisy |
| Domain classification | LLM semantic analysis | No user intervention. The LLM receives section previews and outputs domain assignments |
| Domain selection at generation time | Two-step LLM (select domains → RAG supplement) | Domain documents are primary context (full knowledge), RAG chunks are supplementary (specific details) |
| Path A failure handling | Non-blocking | Document still reaches "ready" status. Path B is the critical path |
| Domain document editing | Future-only | Edits only affect subsequent generations, no cascading re-generation |
| Parallel execution | `Promise.allSettled` after conversion | Both paths process the same source document simultaneously |

### Architecture Diagram

```
Document Upload
      │
      ▼
  convertDocument()          ← Phase 0: Docling replaces convert.py
      │
      │  outputs: full.md + structure.json
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
  LLM classify (2-6 domains)   → micro-split
  LLM summarize per domain     → embed
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
  Domain Tab (Phase 5)   Two-step LLM (Phase 4)
                         1. selectDomainDocuments()
                         2. fetchRagReferences()
                         assembleContext() merges both
```

---

## Phase 0: Docling Integration

### Goal

Replace the 6 custom converters (DOCX/PDF/PPTX/EPUB/HTML/generic) in `convert.py` with a single Docling `DocumentConverter` call. Keep MarkItDown as fallback.

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
| `workers/python/convert.py` | Rewrite | Docling primary + MarkItDown fallback |
| `workers/python/requirements.txt` | Edit | Add `docling`, remove `python-docx`, `python-pptx`, `PyMuPDF` |
| `src/lib/documents/converter.ts` | Rewrite | Change return type from `string` to `ConversionResult` |
| `src/lib/documents/pipeline.ts` | Edit | Add `structurePath` to `ProcessingContext`, update `convertDocument()` |

### 0.1 New `convert.py`

The script outputs JSON to stdout (instead of the current plain text file path). This allows returning both the markdown path and the structure path.

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
    
    # Image extraction
    images_dir = os.path.join(output_dir, "images")
    os.makedirs(images_dir, exist_ok=True)
    image_count = _extract_images(result, images_dir)
    
    return {
        "markdown": md_path,
        "structure": struct_path,
        "imageCount": image_count,
        "format": os.path.splitext(input_path)[1].lower(),
    }

def _extract_images(conversion_result, images_dir):
    """Extract images from Docling conversion result."""
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
                count += 1
    except Exception:
        pass
    return count

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
        "imageCount": 0,
        "format": os.path.splitext(input_path)[1].lower(),
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
            result["fallback"] = True
            result["fallbackReason"] = str(e)
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
  markdown: string;           // path to full.md
  structure: string | null;   // path to structure.json (null if MarkItDown fallback)
  imageCount: number;
  format: string;
  fallback?: boolean;
  fallbackReason?: string;
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

Add `structurePath` to `ProcessingContext` and populate it in `convertDocument()`.

```typescript
// ProcessingContext — add field
export interface ProcessingContext {
  // ... existing fields ...
  structurePath: string | null;  // NEW: path to Docling structure.json
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
  ctx.structurePath = result.structure;  // NEW
  
  if (result.fallback) {
    console.warn(`Docling fallback to MarkItDown: ${result.fallbackReason}`);
  }
  
  return fs.readFileSync(result.markdown, "utf-8");
}
```

### 0.4 Updated `requirements.txt`

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

### 0.5 Docling structure.json Format Reference

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

### 0.6 Acceptance Criteria

- [ ] Upload a PDF with multi-column layout → `structure.json` has correct reading order
- [ ] Upload a DOCX with heading styles → `structure.json` has `section_header` with correct `level` values
- [ ] Upload a PPTX → Docling produces markdown + structure (or falls back to MarkItDown)
- [ ] Upload an HTML file → Docling converts correctly
- [ ] Docling fails (e.g. corrupted file) → Falls back to MarkItDown, `structure` is `null`, document still processes
- [ ] `convertToMarkdown()` returns `ConversionResult` with valid `markdown` path
- [ ] Existing Path B pipeline (split → embed → index) works unchanged with new markdown output
- [ ] Python `docling` package installs without errors on Python 3.13

### 0.7 Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Docling is ~500MB with models | First upload slow | Pre-download models in setup script; MarkItDown fallback if models unavailable |
| Docling doesn't support some format | Conversion fails | Fallback to MarkItDown (existing code) |
| Docling API changes between versions | structure.json format shifts | Pin docling version in requirements.txt; write parser defensively |
| First-run model download exceeds timeout | Upload fails | Increase timeout to 10 min; add progress event for download status |

---

## Phase 1: Data Model

### Goal

Add `DomainDocument` model to store the output of Path A domain splitting.

### Files Changed

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Add `DomainDocument` model + relations |
| `src/types/documents.ts` | Add `DomainDocumentMeta` type |
| `src/types/documents.ts` | No change to `DocumentStatus` — Path A runs during "splitting" phase |

### 1.1 Prisma Schema

Add to `prisma/schema.prisma`:

```prisma
model DomainDocument {
  id            String   @id @default(cuid())
  documentId    String
  userId        String
  domain        String   // snake_case key: "financial_terms"
  domainLabel   String   // display label: "Financial Terminology" / "财务术语"
  title         String   // section heading or generated title
  content       String   // full domain section text (with image refs, tables)
  summary       String?  // LLM-generated summary (for retrieval + context assembly)
  headingPath   String?  // breadcrumb: "Chapter 3 > Section 3.2"
  tokenCount    Int      @default(0)
  index         Int      @default(0)  // global ordering
  sourcePages   String?  // JSON array: "[12,13,14]"

  document      Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user          User     @relation(fields: [userId], references: [id])

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([documentId])
  @@index([userId, domain])
  @@index([documentId, domain])
}
```

Add relation to `Document` model:

```prisma
model Document {
  // ... existing fields ...
  domainDocuments DomainDocument[]
}
```

Add relation to `User` model:

```prism
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
  documentId: string;
  domain: string;
  domainLabel: string;
  title: string;
  summary: string | null;
  headingPath: string | null;
  tokenCount: number;
  index: number;
  sourcePages: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 1.3 Migration

```bash
npx prisma migrate dev --name add-domain-document
```

### 1.4 Acceptance Criteria

- [ ] `DomainDocument` table created with all fields and indexes
- [ ] `Document.domainDocuments` relation works (cascade delete)
- [ ] `DomainDocumentMeta` type matches Prisma model fields
- [ ] Existing tests pass after migration

---

## Phase 2: Domain Splitter

### Goal

Parse Docling's `structure.json` into structured sections, use LLM to classify them into 2-6 domains, generate summaries, and persist to DB.

### Files Created

| File | Description |
|------|-------------|
| `src/lib/documents/docling-parser.ts` | Parse Docling structure.json → `DoclingSection[]` |
| `src/lib/documents/domain-splitter.ts` | LLM domain classification + grouping + summary + persist |

### Files Modified

| File | Description |
|------|-------------|
| `src/lib/prompts/locales/en-prompts.ts` | Add `domainClassify`, `domainSummary` prompts |
| `src/lib/prompts/locales/zh-CN-prompts.ts` | Add `domainClassify`, `domainSummary` prompts |

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
  imageRefs: string[];    // image filenames
  childCount: number;     // number of child elements
}
```

**Function**: `parseDoclingStructure(structureJson: unknown): DoclingSection[]`

Algorithm:
1. Recursively traverse the Docling document tree
2. When encountering `section_header` nodes, start a new section
3. Collect all child content (paragraphs, tables, figures, code blocks) into the current section
4. Build `headingPath` by tracking the parent heading chain
5. Mark `hasTable` / `hasImage` flags based on child node types
6. Return flat array of `DoclingSection[]`

Edge cases:
- Document has no `section_header` nodes → single section with all content
- Deep nesting (H3-H6) → content accumulates under the nearest H1/H2 parent
- Empty sections (heading with no content) → skip

### 2.2 Domain Splitter

**File**: `src/lib/documents/domain-splitter.ts`

#### Main Function Signature

```typescript
export async function splitIntoDomains(
  markdown: string,
  structurePath: string | null,
  documentId: string,
  userId: string,
  writingModel: ModelWithProvider | null,
): Promise<DomainSplitResult>
```

#### Algorithm

```
1. Parse sections
   IF structurePath exists AND file is valid:
     sections = parseDoclingStructure(JSON.parse(file))
   ELSE:
     sections = fallbackMacroSplit(markdown)  // existing splitByMacroAST

2. Short-circuit: if sections.length <= 2
     → single domain, no LLM call
     → summary = first 300 chars of content
     → persist and return

3. Fallback: if no writingModel
     → group by H1 heading (no LLM)
     → summary = first 150 chars per chunk
     → persist and return

4. Build section previews
   For each section: index, headingLevel, headingText, headingPath, charCount, preview (first 200 chars)
   Total preview tokens capped at ~4000

5. LLM call: classifyDomains(previews, writingModel)
   System prompt: domainClassify
   Output: { domains: [{ key, label, sectionIndices }] }

6. Group sections by domain
   Validate sectionIndices are in bounds
   Skip domains with 0 valid sections

7. LLM call: generateDomainSummary(group, writingModel) — parallel across all groups
   System prompt: domainSummary
   Input: domain label + section headings + truncated content (max 4000 tokens)
   Output: plain text summary (150-300 chars)

8. Persist
   Delete existing DomainDocument records for this documentId
   Create new records via prisma.domainDocument.createMany
   Return DomainDocumentMeta[]
```

#### Key Interfaces

```typescript
interface DomainSplitResult {
  domainDocs: DomainDocumentMeta[];
  error?: string;
}

interface SectionPreview {
  index: number;
  headingLevel: number;
  headingText: string;
  headingPath: string;
  charCount: number;
  preview: string;
}

interface DomainClassification {
  domains: {
    key: string;
    label: string;
    sectionIndices: number[];
  }[];
}

interface DomainGroup {
  domain: string;
  domainLabel: string;
  sections: DoclingSection[];
  totalTokens: number;
}
```

### 2.3 Prompts

#### `domainClassify` (EN)

```
You are a document domain analyst. Given a list of document sections with their headings and content previews, classify them into 2-6 thematic domains.

Rules:
- Produce 2-6 domains (no more, no less)
- Domain keys must be lowercase snake_case English (e.g. "financial_analysis")
- Domain labels must be in the SAME LANGUAGE as the document content
- Adjacent sections about related topics should share a domain
- Each section must appear in exactly one domain
- A domain should ideally contain 2+ sections unless the document is short

Output JSON:
{
  "domains": [
    {
      "key": "snake_case_key",
      "label": "Human Readable Label",
      "sectionIndices": [0, 1, 2]
    }
  ]
}
```

#### `domainClassify` (ZH)

```
你是一个文档领域分析专家。给定文档的章节列表（包含标题和内容预览），请将它们分类到 2-6 个主题领域中。

规则:
- 产生 2-6 个领域（不要多也不要少）
- 领域键名必须是小写英文字母+下划线（如 "financial_analysis"）
- 领域标签必须与文档内容使用相同语言
- 相邻且主题相关的章节应归入同一领域
- 每个章节只能出现在一个领域中
- 一个领域最好包含 2 个以上章节，除非文档很短

输出 JSON:
{
  "domains": [
    {
      "key": "snake_case_key",
      "label": "人类可读的标签",
      "sectionIndices": [0, 1, 2]
    }
  ]
}
```

#### `domainSummary` (EN)

```
Summarize the following domain knowledge section. The summary will be used as a retrieval index for AI-powered writing.

Requirements:
- 150-300 characters
- Capture the key topics, methods, and conclusions
- Preserve important terminology
- Do NOT add information not present in the source
- Output plain text, no markdown
```

#### `domainSummary` (ZH)

```
请为以下领域知识章节生成摘要。此摘要将用于AI写作时的检索索引。

要求:
- 150-300 字
- 概括关键主题、方法和结论
- 保留重要专业术语
- 不要添加原文中没有的信息
- 输出纯文本，不要使用 markdown
```

### 2.4 Acceptance Criteria

- [ ] Parse Docling structure.json with nested section_headers → correct heading levels and paths
- [ ] Parse Docling structure.json with no section_headers → single section
- [ ] Invalid structure.json → fallback to macro-split regex
- [ ] 3-section document → single domain, no LLM call
- [ ] 10-section document with writing model → LLM classifies into 2-6 domains
- [ ] 10-section document without writing model → grouped by H1
- [ ] Each domain has a summary (150-300 chars)
- [ ] DomainDocument records created in DB with correct fields
- [ ] Re-processing same document → old DomainDocument records replaced
- [ ] LLM returns invalid JSON → error caught, function returns `{ error }`, does not throw
- [ ] LLM returns sectionIndices out of bounds → invalid indices skipped

---

## Phase 3: Parallel Pipeline

### Goal

Modify `document-worker.ts` to fork into Path A and Path B after document conversion, running both in parallel.

### Files Modified

| File | Description |
|------|-------------|
| `src/lib/queue/workers/document-worker.ts` | Add `Promise.allSettled` fork |

### 3.1 Current Flow

```
processDocument():
  1. status=running (10%)
  2. loadProcessingTask()
  3. supersede check #1
  4. status=converting
  5. convertDocument() → markdown (→40%)
  6. resolveProcessingModels()
  7. calculateSplitPlan() + persist metadata
  8. splitAndPersistChunks() (→60-65%)
  9. supersede check #2
  10. embedDocumentChunks() (→80%)
  11. supersede check #3
  12. indexDocument() (→85-92%)
  13. autoTagDocument()
  14. status=ready (→100%)
```

### 3.2 New Flow

```
processDocument():
  1. status=running (10%)           ← unchanged
  2. loadProcessingTask()            ← unchanged
  3. supersede check #1              ← unchanged
  4. status=converting               ← unchanged
  5. convertDocument()               ← unchanged (→40%)
     now also sets ctx.structurePath
  6. resolveProcessingModels()       ← unchanged
  7. status=splitting

  8. ─── Promise.allSettled ───
     Path A: splitIntoDomains(       ← NEW
       markdown, ctx.structurePath,
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

  10. autoTagDocument()              ← unchanged
  11. status=ready (→100%)           ← unchanged
```

### 3.3 Key Implementation Detail

The existing code between `resolveProcessingModels()` and `autoTagDocument()` is extracted into two closures:

```typescript
const markdown = /* from convertDocument */;
const [pathAResult, pathBResult] = await Promise.allSettled([

  // Path A: Domain splitting
  (async () => {
    try {
      const result = await splitIntoDomains(
        markdown,
        ctx.structurePath,
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
  console.log(`[Path A] Created ${pathAResult.value.domainCount} domain documents`);
} else {
  console.warn("[Path A] Skipped:", ...);
}

if (pathBResult.status === "rejected") {
  throw pathBResult.reason;
}
```

### 3.4 Progress Bar

No change. Path B is the long pole (20-150s). Path A finishes in 8-23s and never adds to total time.

| Stage | Progress | Source |
|-------|----------|--------|
| Start | 10% | Unchanged |
| Converting | 40% | Unchanged |
| Splitting | 60% | Path B split done |
| Embedding | 80% | Path B embed done |
| Indexing | 85-92% | Path B index done |
| Auto-tag | 95% | Adjusted from 92% |
| Ready | 100% | Unchanged |

### 3.5 Acceptance Criteria

- [ ] Upload document → Path A creates DomainDocument records, Path B creates DocumentChunk records
- [ ] Path A throws error → Path B completes, document status = "ready", no DomainDocument records
- [ ] Path B throws error → document status = "failed"
- [ ] Both paths fail → document status = "failed" (Path B error thrown)
- [ ] Progress bar updates correctly (same percentages as before)
- [ ] Supersede checks still work (cancel during Path B embed/index)
- [ ] Graph index follow-up task still enqueued after completion

---

## Phase 4: Generation Context

### Goal

When generating a section, add a domain selection step before RAG retrieval. The selected domain documents are injected into the prompt as primary context.

### Files Modified

| File | Description |
|------|-------------|
| `src/lib/writing/generator.ts` | Add `selectDomainDocuments()` call, pass results to `assembleContext()` |
| `src/lib/writing/context.ts` | Add `domainDocuments` to `ContextInput`, add `buildDomainDocumentsSection()` |
| `src/lib/prompts/locales/en-prompts.ts` | Add `domainSelect` prompt |
| `src/lib/prompts/locales/zh-CN-prompts.ts` | Add `domainSelect` prompt |

### 4.1 Modified `generateSectionFull()` Flow

```
1. Resolve LLM model                   (existing)
2. enrichSectionContext()               (existing — generates retrieval query)
3. selectDomainDocuments()              ← NEW: LLM selects 0-4 domain docs
4. fetchRagReferences()                 (existing — semantic search)
5. Build effective constraints          (existing)
6. assembleContext({                    (modified — includes domainDocuments)
     ...existing,
     domainDocuments: domainDocs
   })
7. LLM chat call                        (existing)
8. Record token usage                   (existing)
9. Return { ..., domainDocuments }      (modified)
```

### 4.2 New Function: `selectDomainDocuments()`

```typescript
async function selectDomainDocuments(
  draftTitle: string,
  section: { title: string; description?: string | null; keyPoints?: string | null },
  userId: string,
  provider: any,
  modelId: string,
  ragDocumentIds?: string[],
): Promise<DomainDocumentMeta[]>
```

Algorithm:
1. Load all user's DomainDocuments from DB (filtered by `ragDocumentIds` if manual mode)
2. If no domain documents exist, return `[]`
3. Build compact index: `{ id, domain (label), title, summary (first 150 chars), tokens }`
4. LLM call with `domainSelect` system prompt and section context as user message
5. Parse response: `{ selectedIds: string[] }`
6. Return full DomainDocumentMeta for selected IDs
7. On any error (invalid JSON, bad IDs) → return `[]` silently (non-blocking fallback to RAG-only)

Parameters:
- `temperature: 0.2` — low for consistent selection
- `response_format: { type: "json_object" }` — enforce structured output

### 4.3 `domainSelect` Prompt (EN)

```
You are selecting the most relevant domain knowledge documents for writing a specific section of a document.

Given:
1. The draft title and section being written
2. A list of available domain documents (with ID, domain label, title, and summary)

Select 0-4 domain document IDs that are most relevant to the section being written. Prioritize:
- Directly related topics (same domain)
- Foundational/contextual knowledge the section depends on
- Methodologies or frameworks mentioned in the section description

Do NOT select documents that are tangentially related. It's better to select 0-2 highly relevant ones than 4 marginally related ones.

Output JSON:
{ "selectedIds": ["id1", "id2"] }

If no domain documents are relevant, output: { "selectedIds": [] }
```

### 4.4 `domainSelect` Prompt (ZH)

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

### 4.5 Modified `assembleContext()`

Add `domainDocuments` to `ContextInput`:

```typescript
interface ContextInput {
  // ... existing fields ...
  domainDocuments?: DomainDocumentMeta[];
}
```

New function `buildDomainDocumentsSection()`:

- Constants: `DOMAIN_DOC_TOTAL_CHAR_LIMIT = 8000`, `DOMAIN_DOC_PER_CHAR_LIMIT = 4000`
- Group domain docs by domain
- For each group, emit heading + source path + content
- Truncate individual docs to per-doc limit
- Stop when total char budget exhausted
- Return empty string if no domain docs

Insert into user message after RAG references (block order: outline → completed summaries → RAG → **domain docs** → target section → constraints → instruction).

Format in prompt:

```
## Domain Knowledge Base

The following domain-specific documents are the primary reference for this section.
Prioritize them over the RAG references above.

### Financial Analysis — Chapter 3: Financial Statements
> Source: annual_report.pdf

[full content or truncated content]

---

### Financial Analysis — Chapter 4: Ratio Analysis
> Source: annual_report.pdf

[full content or truncated content]
```

### 4.6 Latency Impact

- Domain selection LLM call: ~2-5s (small prompt, JSON output, temperature 0.2)
- DB query for domain docs: ~0.1s
- Content truncation + assembly: ~0.01s
- **Total overhead per section: ~2-5s** (3-7% of total generation time)

### 4.7 Acceptance Criteria

- [ ] Section generation with domain docs available → prompt contains domain docs section
- [ ] Section generation with no domain docs → prompt unchanged from current behavior
- [ ] Domain selection returns 0-4 IDs
- [ ] Domain selection returns empty array for unrelated sections
- [ ] Domain docs in prompt respect 8000 char total budget
- [ ] Single domain doc exceeding 4000 chars is truncated
- [ ] LLM returns invalid JSON → fallback to empty domain docs, generation still succeeds
- [ ] `ragMode === "manual"` → only domain docs from specified documents are considered
- [ ] `ragMode === "off"` → domain docs still selected (domain selection is independent of RAG mode)
- [ ] `FullGenerationResult` includes `domainDocuments` field

---

## Phase 5: Library UI

### Goal

Add a "Domain Documents" tab to the Library page for browsing and editing domain documents.

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

Response:
```json
{
  "success": true,
  "data": DomainDocumentMeta & { "documentName": "annual_report.pdf" }
}
```

Joins with Document table to include source document name.

#### `PUT /api/v1/library/domains/[id]`

Body:
```json
{
  "content": "...",
  "summary": "..."
}
```

Validates ownership (userId match). Updates `content` and/or `summary`. Returns updated record.

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

Returns distinct domains for the current user with document counts.

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
    {/* Existing Stats ribbon + Document table — unchanged */}
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
│                                                  │
│ 📁 Financial Analysis (5)                        │
│ ┌────────────────────────────────────────────┐   │
│ │ Chapter 3: Financial Statements           │   │
│ │ Summary preview (150 chars)...             │   │
│ │ 1,234 tokens · Source: annual_report.pdf   │   │
│ │                          [Edit] [View]     │   │
│ └────────────────────────────────────────────┘   │
│ ┌────────────────────────────────────────────┐   │
│ │ Chapter 4: Ratio Analysis                  │   │
│ │ ...                                        │   │
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
- Edit button → opens `DomainDocumentEditModal`
- View button → expand card to show full content

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

Save calls `PUT /api/v1/library/domains/[id]`. Future-only behavior — edits only affect subsequent generations.

### 5.5 Acceptance Criteria

- [ ] Library page shows two tabs: Documents and Domain Knowledge
- [ ] Domain tab shows domain documents grouped by domain
- [ ] Domain filter dropdown shows all distinct domains
- [ ] Source document filter dropdown shows source document names
- [ ] Edit modal opens, allows editing content and summary
- [ ] Save persists changes via PUT API
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

The existing `SectionReference` component already renders all references. Domain doc references will appear with `[Domain]` prefix in the document name, naturally distinguishing them from RAG chunk references.

Optional enhancement: Add a colored badge (e.g. purple) for domain references vs blue for RAG references.

### 6.3 Acceptance Criteria

- [ ] After generation with domain docs → SectionReference records created with `[Domain]` prefix
- [ ] Reference list shows domain references alongside RAG references
- [ ] `relevanceScore` is 1.0 for domain references (LLM-selected)
- [ ] `sourceAnchor` contains headingPath
- [ ] Generation with no domain docs → no domain SectionReference records created
- [ ] Re-generation of same section → old domain references replaced (existing delete+recreate pattern)

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
| Figure inside section | section_header + figure child | `hasImage: true, imageRefs: [...]` |
| Deep nesting (H3 under H2 under H1) | 3-level hierarchy | Content under H3 accumulates, headingPath = "H1 > H2 > H3" |

**File**: `src/lib/documents/__tests__/domain-splitter.test.ts`

| Case | Input | Expected |
|------|-------|----------|
| Small document (2 sections) | 2 DoclingSections | Single domain, no LLM call |
| No writing model | 10 sections, null model | Grouped by H1, no LLM call |
| Normal classification | 10 sections, mock LLM returning 3 domains | 3 DomainGroups with correct section assignments |
| LLM returns invalid JSON | Mock LLM returning "not json" | Returns `{ error }`, no throw |
| LLM returns out-of-bounds indices | Mock LLM returning `[99]` | Invalid indices skipped |
| Duplicate section in two domains | Mock LLM returning `[0,1]` and `[1,2]` | Section 1 appears in first domain only |
| Persist + re-process | Create docs, then re-process | Old records deleted, new records created |

### 7.2 Integration Tests

| Scenario | Steps | Verify |
|----------|-------|--------|
| Full pipeline happy path | Upload PDF → wait for ready | DomainDocument + DocumentChunk records created |
| Path A failure | Mock splitIntoDomains to throw | Document still reaches "ready", no DomainDocument records |
| Path B failure | Mock embedDocumentChunks to throw | Document status = "failed" |
| Generation with domains | Generate section on draft with domain docs | Prompt contains domain docs block, response includes domainDocuments |
| Generation without domains | Generate section on draft with no domain docs | Prompt has no domain docs block (same as current) |
| Edit domain doc | PUT updated content → generate section | New content appears in generated output |

### 7.3 Manual Test Checklist

- [ ] Upload Chinese PDF (50+ pages) → Check domain classification quality (2-6 domains, Chinese labels)
- [ ] Upload English DOCX → Check domain labels are in English
- [ ] Upload single-page document → Single domain, no LLM classification call
- [ ] Library → Domain tab → All domains visible, grouped correctly
- [ ] Library → Domain tab → Edit a domain doc → Save → Verify updated content in DB
- [ ] Generate section → Check reference list shows `[Domain]` prefixed references
- [ ] Generate section → Check prompt in logs contains "Domain Knowledge Base" section
- [ ] Re-process same document → Old domain docs replaced, new ones created
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
| 0. Docling Integration | 3h | None |
| 1. Data Model | 0.5h | None |
| 2. Domain Splitter | 2.5h | Phase 0, 1 |
| 3. Parallel Pipeline | 1.5h | Phase 2 |
| 4. Generation Context | 3h | Phase 1 |
| 5. Library UI | 3h | Phase 1 |
| 6. Reference Display | 1h | Phase 4 |
| 7. Testing | 3h | All |
| **Total** | **~17h** | |

Critical path: Phase 0 → 1 → 2 → 3 → 4 → 6 → 7

Parallel opportunity: Phase 5 (UI) can start after Phase 1, independent of Phases 2-4.

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Docling model download fails on user machine | Medium | High (blocks all conversion) | MarkItDown fallback kicks in; pre-download script in setup |
| Docling doesn't support a user's file format | Low | Medium (structure.json = null) | Fallback to macro-split regex; Path A still works with degraded quality |
| LLM domain classification produces inconsistent results | Medium | Medium (domains vary between runs) | Temperature 0.3; JSON schema validation; user can edit domain docs afterward |
| LLM domain selection picks wrong docs during generation | Low | Medium (noise in prompt) | Returns 0-4 docs; allowed to return empty; user can edit/trim domain docs |
| SQLite performance with DomainDocument table | Low | Low (small data volume) | 2-20 records per document, batch createMany |
| Prompt context budget exceeded with domain docs + RAG | Low | Medium (truncated content) | Hard char limits (8000 domain + 12000 RAG); domain docs truncated first |
| structure.json format changes in future Docling version | Low | Medium (parser breaks) | Pin docling version; defensive parsing; fallback to macro-split |
