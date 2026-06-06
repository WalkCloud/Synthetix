# 大文档处理提速最终实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不牺牲文档质量、chunk 边界精度、RAG 召回精度、知识图谱正确性和指令遵循能力的前提下，显著缩短大文档上传后的可用等待时间。

**Architecture:** 将“大文档可基础检索”和“知识图谱完整构建”拆成两个状态明确的阶段。阶段一完整等待转换、拆分、chunk 持久化、embedding、FTS/basic retrieval 完成后才标记 `ready`；阶段二将 graph indexing 放到后台任务，并通过单独的 graph 状态暴露进度和失败原因。

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, SQLite via better-sqlite3, Vitest, Python workers, PyMuPDF, LightRAG.

---

## 0. 不可妥协原则

本方案参考并交叉评估了：

- `docs/document-processing-optimization-plan.md`
- `docs/document-indexing-speedup-plan.md`
- 当前代码中的 document upload、worker、pipeline、splitter、semantic splitter、LightRAG indexing、FTS、semantic search、status API 和处理设置 UI。

最终执行必须遵守以下原则：

1. 不能为了速度降低 chunk 边界质量。
2. 不能为了速度降低 RAG top-k 召回精度。
3. 不能为了速度把未完成的 graph indexing 伪装成完整 ready。
4. 不能 fire-and-forget DB embedding 写入、chunk 文件写入或 `embeddings.bin` 写入。
5. 不能默认关闭大 PDF 的全部图片提取。
6. 不能用纯向量阈值或全局 TOC 决策无条件替代高精度拆分。
7. 所有性能优化必须有质量回归测试和阶段耗时指标。

---

## 1. 当前处理流程

```text
POST /api/v1/documents/upload
  |
  v
create Document(status=uploading)
  |
  v
queue.submit("document_convert", { docId, options })
  |
  v
processDocument(taskId)
  |
  v
convert original file -> full.md
  |
  v
resolve LLM model + embedding model
  |
  v
calculate split plan
  |
  v
splitMarkdown()
  |
  v
optional semanticSplit()
  |
  v
persist chunks to DB + chunk_*.md files
  |
  v
embed chunks
  |
  v
write DB embeddings + embeddings.bin
  |
  v
sync FTS
  |
  v
LightRAG index basic or graph
  |
  v
auto tag
  |
  v
Document(status=ready)
```

### Key Files

| Area | File | Responsibility |
|---|---|---|
| Upload route | `src/app/api/v1/documents/upload/route.ts` | Validate file, create document row, save original, submit queue task |
| Queue types | `src/lib/queue/types.ts` | Task types, processing options, split/index modes |
| Queue registration | `src/lib/queue/index.ts` | Register workers and timeouts |
| Queue engine | `src/lib/queue/queue.ts` | Claim tasks, execute workers, manage progress/failure |
| Document worker | `src/lib/queue/workers/document-worker.ts` | Orchestrate conversion, split, embedding, indexing, tagging |
| Pipeline | `src/lib/documents/pipeline.ts` | Core processing functions and LightRAG Python invocation |
| Structural splitter | `src/lib/documents/splitter.ts` | Heading/title/line based chunking |
| Semantic splitter | `src/lib/documents/semantic-splitter.ts` | LLM adjacent-title merge decisions |
| Converter | `workers/python/convert.py` | Convert PDF/DOCX/PPTX/XLSX/HTML/EPUB/TXT/MD to Markdown |
| LightRAG index | `workers/python/rag_index.py` | Insert chunk files into LightRAG storage |
| LightRAG query | `workers/python/rag_query.py` | Query LightRAG, already checks `.indexing.lock` |
| FTS search | `src/lib/search/fts.ts` | SQLite FTS5 keyword index and search |
| Hybrid search | `src/lib/search/semantic.ts` | LightRAG + DB embedding fallback + FTS fusion |
| Status API | `src/app/api/v1/documents/[id]/status/route.ts` | Current document task status, currently only `document_convert` |
| Processing UI | `src/components/documents/processing-settings.tsx` | Split/index settings exposed to users |

---

## 2. Final Decisions From Cross-Review

| Proposal | Decision | Final Implementation Direction |
|---|---|---|
| Two-stage readiness | Accept with required status changes | `ready` means basic retrieval ready; graph state is separate |
| Prisma SQLite embedding transaction batching | Accept with ordering and awaited writes | Batch DB writes inside awaited transactions, never background them |
| LightRAG bulk ingestion | Accept behind compatibility checks | Use bounded bulk insert only after proving ID/file/embedding alignment |
| Fire-and-forget DB or file I/O | Reject | All required artifacts must be complete before `ready` |
| Vector-only semantic merge | Reject as default | Vector/TOC may only prefilter or assist, not replace precision rules |
| Global TOC-only split decision | Reject as unconditional default | Use bounded hierarchical decisions or skip LLM merge for huge docs |
| Large PDF image extraction disabled by default | Reject | Implement selective important-image extraction instead |
| 45s full graph indexing target for 80MB/10k chunks | Reject as quality-unsafe | Target fast basic retrieval; graph may continue in background |

---

## 3. Target State

```text
upload
  |
  v
convert -> split -> persist chunks -> embed -> write DB embeddings + embeddings.bin
  |                         |           |
  |                         |           v
  |                         |       ordered embedding manifest
  |                         v
  |                    chunk files complete
  v
sync FTS -> basic LightRAG/vector index -> auto tag -> document.status = ready
  |
  v
if indexMode=graph: enqueue graph indexing task
  |
  v
graph worker -> LightRAG lock -> bounded bulk/serial graph indexing -> graphStatus completed/failed
```

### Status Semantics

`Document.status = "ready"` means all of these are true:

- `full.md` exists.
- `document_chunks` rows exist and are ordered by `index`.
- Required `chunk_*.md` files exist for indexing.
- DB embeddings are written for every valid chunk.
- `embeddings.bin` is complete and aligned with chunk order.
- FTS has been synced.
- Basic retrieval is available.

Graph readiness is separate:

```ts
type GraphStatus = "not_requested" | "pending" | "running" | "completed" | "failed";
```

The implementation can avoid a Prisma schema migration at first by deriving `graphStatus` from an `AsyncTask` row. A later schema migration can add durable graph fields only if UI and analytics need them.

---

## 4. File Structure Plan

### Modify Existing Files

| File | Changes |
|---|---|
| `src/lib/queue/types.ts` | Add graph task type or standardize use of existing `rag_index`; add split/image policy option types if needed |
| `src/lib/queue/index.ts` | Register graph indexing worker with an explicit timeout |
| `src/lib/queue/workers/document-worker.ts` | Split basic readiness from background graph scheduling |
| `src/lib/queue/workers/document-graph-worker.ts` | New focused graph worker if not reusing `rag_index` worker |
| `src/lib/documents/pipeline.ts` | Ordered chunk reads, awaited embedding batch transactions, embedding manifest, basic/graph indexing split |
| `src/lib/documents/splitter.ts` | Add sentence-aware recursive fallback and stricter boundary preservation |
| `src/lib/documents/semantic-splitter.ts` | Add validation for LLM merge decisions and large-doc guardrails |
| `workers/python/rag_index.py` | Add indexing lock, bounded bulk insert, fallback serial mode, post-insert validation |
| `workers/python/convert.py` | Add image extraction policy and important-image filtering |
| `src/app/api/v1/documents/[id]/status/route.ts` | Return document task status plus graph status/progress/error |
| `src/components/documents/processing-settings.tsx` | Add quality-preserving large-doc options if user control is needed |
| i18n files for document processing labels | Add labels for graph status, image policy, and large-doc split strategy |

### Add New Files

| File | Responsibility |
|---|---|
| `src/lib/queue/workers/document-graph-worker.ts` | Background graph indexing task runner |
| `src/lib/documents/embedding-manifest.ts` | Build/read/validate chunk-to-embedding manifest |
| `src/lib/documents/processing-metrics.ts` | Stage timing helpers, stored in task result data or logs |
| `src/__tests__/documents/pipeline-embedding-order.test.ts` | Verify embedding ordering and manifest alignment |
| `src/__tests__/documents/splitter-boundaries.test.ts` | Verify sentence/table/code/Chinese boundary behavior |
| `src/__tests__/queue/document-graph-worker.test.ts` | Verify graph failure does not mark document failed |
| `src/__tests__/api/document-status.test.ts` | Verify basic status and graph status response shape |
| `workers/python/tests/test_rag_index_lock_and_bulk.py` | Verify lock lifecycle and bulk fallback behavior |
| `workers/python/tests/test_convert_image_policy.py` | Verify important-image extraction policy |

If Python test infrastructure is not present, create it under `workers/python/tests/` and document the command in this plan. The TypeScript test framework already uses Vitest via `npm test` and `npm run test:run`.

---

## 5. Phase 0: Baseline Instrumentation

**Goal:** Measure before optimizing. This prevents accepting fake speedups that reduce quality.

**Files:**

- Create: `src/lib/documents/processing-metrics.ts`
- Modify: `src/lib/queue/workers/document-worker.ts`
- Modify: `src/lib/documents/pipeline.ts`

### Required Metrics

Capture these durations and counts in task `resultData` or structured logs:

```ts
export interface DocumentProcessingMetrics {
  conversionMs: number;
  markdownBytes: number;
  tokenEstimate: number;
  structuralChunkCount: number;
  finalChunkCount: number;
  semanticSplitMs: number;
  semanticSplitInputTokens: number;
  semanticSplitOutputTokens: number;
  chunkDbPersistMs: number;
  chunkFilePersistMs: number;
  embeddingApiMs: number;
  embeddingDbPersistMs: number;
  embeddingsBinWriteMs: number;
  ftsSyncMs: number;
  lightragBasicIndexMs: number;
  lightragGraphIndexMs: number;
  extractedImageCount: number;
  extractedImageBytes: number;
}
```

### Steps

- [ ] Create `src/lib/documents/processing-metrics.ts` with a small timer helper:

```ts
export function nowMs(): number {
  return Date.now();
}

export function elapsedMs(startMs: number): number {
  return Date.now() - startMs;
}
```

- [ ] Add metrics collection around each pipeline stage without changing behavior.
- [ ] Store metrics in `async_tasks.resultData` only when the task completes.
- [ ] Run `npm run test:run`.
- [ ] Run `npm run lint`.

**Acceptance:** Existing tests pass, and a processed document task has stage timing data.

---

## 6. Phase 1: Embedding Order and SQLite Batch Writes

**Goal:** Remove SQLite write amplification while preserving exact chunk-to-embedding alignment.

**Files:**

- Modify: `src/lib/documents/pipeline.ts`
- Create: `src/lib/documents/embedding-manifest.ts`
- Create: `src/__tests__/documents/pipeline-embedding-order.test.ts`

### Required Behavior

1. `db.documentChunk.findMany()` in `embedDocumentChunks()` must use `orderBy: { index: "asc" }`.
2. Embeddings must be persisted in awaited transaction batches.
3. `embeddings.bin` must follow the same ordered chunk list.
4. A manifest should map chunk index and chunk ID to embedding offset.
5. The document must not reach `ready` until all DB embeddings and binary artifacts are complete.

### Implementation Shape

In `pipeline.ts`, change chunk loading to this shape:

```ts
const allChunks = await db.documentChunk.findMany({
  where: { documentId: docId },
  orderBy: { index: "asc" },
});
```

Use an awaited transaction batch helper:

```ts
const EMBEDDING_UPDATE_BATCH_SIZE = Number(process.env.EMBEDDING_UPDATE_BATCH_SIZE || 200);

async function persistEmbeddingUpdates(
  updates: Array<{ chunkId: string; embedding: Uint8Array; embedModel: string }>,
): Promise<void> {
  for (let i = 0; i < updates.length; i += EMBEDDING_UPDATE_BATCH_SIZE) {
    const batch = updates.slice(i, i + EMBEDDING_UPDATE_BATCH_SIZE);
    await db.$transaction(
      batch.map((u) => db.documentChunk.update({
        where: { id: u.chunkId },
        data: { embedding: u.embedding, embedModel: u.embedModel },
      })),
    );
  }
}
```

Create manifest records:

```ts
export interface EmbeddingManifestEntry {
  chunkId: string;
  chunkIndex: number;
  embeddingOffset: number;
  embeddingDim: number;
}

export interface EmbeddingManifest {
  documentId: string;
  embedModel: string;
  embeddingDim: number;
  entries: EmbeddingManifestEntry[];
}
```

Write `embedding_manifest.json` next to `embeddings.bin`.

### Tests

- [ ] Add a Vitest test proving chunks are embedded in ascending `index` order.
- [ ] Add a Vitest test proving `embeddings.bin` count/dim matches manifest.
- [ ] Add a Vitest test proving transaction failure prevents `ready` state in worker-level test.
- [ ] Run `npm run test:run -- src/__tests__/documents/pipeline-embedding-order.test.ts`.
- [ ] Run `npm run test:run -- src/__tests__/documents/embedder.test.ts src/__tests__/documents/storage.test.ts`.

**Acceptance:** No embedding can be associated with the wrong chunk, and SQLite write time is measured before/after.

---

## 7. Phase 2: Two-Stage Basic Ready and Graph Status

**Goal:** Make large documents usable for basic RAG earlier without lying about graph completion.

**Files:**

- Modify: `src/lib/queue/types.ts`
- Modify: `src/lib/queue/index.ts`
- Modify: `src/lib/queue/workers/document-worker.ts`
- Create: `src/lib/queue/workers/document-graph-worker.ts`
- Modify: `src/app/api/v1/documents/[id]/status/route.ts`
- Create: `src/__tests__/queue/document-graph-worker.test.ts`
- Create: `src/__tests__/api/document-status.test.ts`

### Task Type Decision

Preferred minimal path: reuse existing `TaskType` member `"rag_index"` for background graph work.

If a clearer name is preferred, add:

```ts
export type TaskType =
  | "document_upload"
  | "document_convert"
  | "document_graph_index"
  | "rag_index"
  | "chapter_generate"
  | "chapter_summarize"
  | "outline_generate"
  | "draft_generate_all";
```

Use only one graph task type consistently. Do not create both in active code paths.

### Worker Flow

`document-worker.ts` should do this:

```text
convert
  -> split
  -> embed
  -> sync FTS
  -> basic index if needed
  -> auto tag
  -> document.status = ready
  -> document_convert task completed
  -> if indexMode=graph, submit graph task
```

Graph worker should do this:

```text
load doc and original processing options
  -> resolve models
  -> run graph-only LightRAG indexing
  -> mark graph task completed or failed
```

Graph worker failure must not do this:

```ts
await db.document.update({
  where: { id: docId },
  data: { status: "failed" },
});
```

### Status API Shape

Update `src/app/api/v1/documents/[id]/status/route.ts` to return:

```ts
return successResponse({
  documentId: doc.id,
  status: doc.status,
  taskId: documentTask?.id,
  taskStatus: documentTask?.status,
  progress: documentTask?.progress || 0,
  error: documentTask?.errorMessage,
  graph: {
    requested: Boolean(graphTask),
    taskId: graphTask?.id,
    status: graphTask?.status ?? "not_requested",
    progress: graphTask?.progress ?? 0,
    error: graphTask?.errorMessage,
  },
});
```

### Tests

- [ ] Document graph task failure leaves `Document.status` as `ready`.
- [ ] Status API returns both base processing and graph processing status.
- [ ] Queue registers the chosen graph task type.
- [ ] Run `npm run test:run -- src/__tests__/queue/document-graph-worker.test.ts src/__tests__/api/document-status.test.ts`.

**Acceptance:** Basic retrieval ready is visible before graph completion, and graph state is explicit.

---

## 8. Phase 3: LightRAG Locking and Guarded Bulk Insert

**Goal:** Reduce LightRAG indexing overhead without corrupting graph/vector storage or misaligning embeddings.

**Files:**

- Modify: `workers/python/rag_index.py`
- Modify: `src/lib/documents/pipeline.ts`
- Create: `workers/python/tests/test_rag_index_lock_and_bulk.py`

### Required Lock Contract

`workers/python/rag_query.py` already checks `.indexing.lock`. `rag_index.py` must create and clear it.

Required shape:

```python
lock_path = os.path.join(working_dir, ".indexing.lock")
with open(lock_path, "w", encoding="utf-8") as fp:
    fp.write(doc_id)
try:
    await rag.initialize_storages()
    # indexing work
finally:
    if os.path.exists(lock_path):
        os.remove(lock_path)
```

### Bulk Insert Rules

1. Preserve chunk IDs: `f"{doc_id}/{f.replace('.md', '')}"`.
2. Preserve `file_paths` as a list when using list contents.
3. Use bounded batches, default 20 or 40, not all chunks at once.
4. If the installed LightRAG version rejects list input, fall back to serial insert.
5. Verify indexed count equals input chunk count.
6. If cached embeddings are used, validate manifest order before indexing.

### Python Function Shape

Implement a helper with this behavior:

```python
async def insert_chunks(rag, chunk_records, batch_size: int) -> int:
    indexed = 0
    for i in range(0, len(chunk_records), batch_size):
        batch = chunk_records[i:i + batch_size]
        contents = [item["content"] for item in batch]
        ids = [item["id"] for item in batch]
        paths = [item["path"] for item in batch]
        try:
            await rag.ainsert(contents, ids=ids, file_paths=paths)
            indexed += len(batch)
        except TypeError:
            for item in batch:
                await rag.ainsert(item["content"], ids=item["id"], file_paths=item["path"])
                indexed += 1
    return indexed
```

If `LightRAG` raises a non-compatibility error, do not silently fall back. Return failure so the task can retry or surface the error.

### Tests

- [ ] Lock file is created during indexing.
- [ ] Lock file is removed after success.
- [ ] Lock file is removed after exception.
- [ ] Bulk insert preserves IDs and file paths.
- [ ] Serial fallback executes only on API compatibility errors.
- [ ] Run Python tests with `python -m pytest workers/python/tests/test_rag_index_lock_and_bulk.py` after pytest is available.

**Acceptance:** Query never sees a half-written LightRAG index as complete, and bulk mode is correctness-guarded.

---

## 9. Phase 4: Quality-Preserving Large-Document Splitting

**Goal:** Avoid semantic split timeouts while improving, not degrading, chunk boundary quality.

**Files:**

- Modify: `src/lib/queue/types.ts`
- Modify: `src/lib/documents/splitter.ts`
- Modify: `src/lib/documents/semantic-splitter.ts`
- Modify: `src/lib/documents/pipeline.ts`
- Modify: `src/components/documents/processing-settings.tsx` if exposing strategy
- Create: `src/__tests__/documents/splitter-boundaries.test.ts`

### Strategy Names

Extend split strategy carefully:

```ts
export type SplitStrategy =
  | "structure-llm"
  | "heading-only"
  | "large-structural-precise";
```

Do not remove `structure-llm`. It remains the high-precision option for normal documents.

### Large-Document Gate

Use explicit thresholds:

```ts
const LARGE_DOC_CHUNK_THRESHOLD = Number(process.env.LARGE_DOC_CHUNK_THRESHOLD || 300);
const LARGE_DOC_TOKEN_THRESHOLD = Number(process.env.LARGE_DOC_TOKEN_THRESHOLD || 200_000);
```

If a document exceeds either threshold, do not send hundreds of LLM semantic merge requests. Use `large-structural-precise` behavior unless the user explicitly selected high-quality slow LLM mode.

### Splitter Requirements

Sentence-aware fallback must try separators in this order:

```text
markdown headings
paragraph boundaries
sentence punctuation: 。！？.!?
line boundaries
character fallback
```

It must preserve:

- `headingPath`
- chunk title
- max token budget
- overlap where configured
- table rows where possible
- code blocks where possible

### Semantic Merge Guardrails

Before applying LLM merge decisions:

1. Reject non-adjacent indices.
2. Reject out-of-range indices.
3. Reject merges that exceed `chunkMaxTokens` unless they will be deterministically re-split by sentence boundaries.
4. Reject merges across unrelated top-level heading branches unless explicitly allowed by a safe rule.
5. Default to keep separate when uncertain.

### Tests

- [ ] Chinese numbered headings are preserved.
- [ ] Long Chinese paragraphs split at `。` without sentence truncation.
- [ ] English paragraphs split at sentence punctuation.
- [ ] Markdown tables are not split mid-row when avoidable.
- [ ] Code fences are not split mid-block when avoidable.
- [ ] LLM merge decisions with non-adjacent indices are ignored.
- [ ] LLM merge decisions with out-of-range indices are ignored.
- [ ] Run `npm run test:run -- src/__tests__/documents/splitter.test.ts src/__tests__/documents/splitter-boundaries.test.ts`.

**Acceptance:** Large-document splitting becomes faster because it avoids unbounded LLM calls, and boundary tests prove no quality shortcut was added.

---

## 10. Phase 5: Selective PDF Image Extraction

**Goal:** Reduce image I/O for large PDFs while preserving important figures, diagrams, screenshots, and evidence images.

**Files:**

- Modify: `workers/python/convert.py`
- Modify: `src/lib/queue/types.ts` if exposing image policy in upload options
- Modify: `src/components/documents/processing-settings.tsx` if exposing user control
- Create: `workers/python/tests/test_convert_image_policy.py`

### Image Policy

Use explicit policy values:

```ts
export type ImageExtractionPolicy = "all" | "important" | "none";
```

Default should be:

```text
small documents: all
large documents: important
none: only when the user explicitly selects text-only fast mode
```

### Important Image Rules

For PDF images, skip likely decorative images when all of these indicate low value:

- very small byte size
- very small width/height
- tiny page area ratio
- duplicate hash already extracted many times
- mask/stencil/background asset if PyMuPDF metadata identifies it

Preserve images when any of these are true:

- large page area ratio
- width/height above figure threshold
- unique non-trivial hash
- likely diagram/screenshot size

### Python Helper Shape

```python
def should_extract_image(meta: dict, policy: str, seen_hashes: dict) -> bool:
    if policy == "all":
        return True
    if policy == "none":
        return False
    width = int(meta.get("width") or 0)
    height = int(meta.get("height") or 0)
    size = int(meta.get("size") or 0)
    digest = meta.get("hash") or ""
    if size < 2_048 and width < 128 and height < 128:
        return False
    if digest and seen_hashes.get(digest, 0) >= 3 and width < 512 and height < 512:
        return False
    return width >= 256 or height >= 256 or size >= 10_240
```

Tune thresholds with fixtures before enabling broadly.

### Tests

- [ ] Small PDF keeps all images in `all` mode.
- [ ] Large PDF in `important` mode skips repeated tiny logos.
- [ ] Large PDF in `important` mode preserves a large chart image.
- [ ] `none` mode is only used when explicitly requested in options.
- [ ] Run `python -m pytest workers/python/tests/test_convert_image_policy.py` after pytest is available.

**Acceptance:** Large-PDF conversion is faster without silently dropping important visual content.

---

## 11. Phase 6: Search Quality Gates

**Goal:** Make quality measurable so performance work cannot regress retrieval precision.

**Files:**

- Create: `src/__tests__/documents/retrieval-quality.test.ts`
- Modify: `src/lib/search/semantic.ts` only if needed for testability

### Required Fixtures

Create deterministic fixtures in tests, not production data:

1. Structured English document with known answer sections.
2. Structured Chinese document with numbered sections.
3. Poorly structured long document with no markdown headings.
4. Document with tables and code fences.
5. Document with figure references.

### Metrics

At minimum, tests must check:

- known relevant chunk appears in top 5 for fixed query
- top 10 overlap does not drop after split/index change
- keyword FTS still returns expected chunk
- direct DB embedding fallback is not treated as quality-equivalent for >2,000 chunks

For graph mode equivalence, compare serial and bulk LightRAG fixture results:

```text
serial graph entities == expected entities
bulk graph entities includes expected entities
serial graph relations == expected relations
bulk graph relations includes expected relations
source chunk IDs preserved
```

**Acceptance:** No speed optimization merges unless retrieval quality gates pass.

---

## 12. Phase 7: UI and Copy Updates

**Goal:** Users must understand that basic retrieval can be ready while graph indexing continues.

**Files:**

- Modify: `src/components/documents/upload-queue-panel.tsx`
- Modify: `src/components/library/document-table.tsx`
- Modify: `src/components/documents/processing-settings.tsx`
- Modify: locale files used by document processing labels

### Required UI States

Show these states distinctly:

```text
Converting
Splitting
Embedding
Indexing basic search
Ready for search
Building knowledge graph
Knowledge graph ready
Knowledge graph failed
```

Do not show graph-mode documents as fully graph-ready when only basic retrieval is ready.

### Copy Requirement

Use copy like:

```text
Ready for search. Knowledge graph indexing is still running.
```

and:

```text
Knowledge graph indexing failed. Basic document search is still available.
```

**Acceptance:** Status is truthful and useful to the user.

---

## 13. Execution Order

Use this order to keep each step safe and reversible:

1. Phase 0 metrics.
2. Phase 1 embedding ordering and DB transaction batching.
3. Phase 2 two-stage ready and graph status.
4. Phase 3 LightRAG lock and guarded bulk insert behind feature flag.
5. Phase 4 splitter boundary improvements.
6. Phase 5 selective image extraction.
7. Phase 6 retrieval quality gates.
8. Phase 7 UI and copy.

Do not implement LightRAG bulk insert before embedding order is fixed. Do not implement graph background indexing before graph status is visible. Do not change splitter behavior before boundary tests exist.

---

## 14. Verification Commands

Run these after relevant phases:

```bash
npm run test:run
npm run lint
npm run build
```

Targeted commands:

```bash
npm run test:run -- src/__tests__/documents/splitter.test.ts
npm run test:run -- src/__tests__/documents/embedder.test.ts
npm run test:run -- src/__tests__/queue/queue.test.ts
npm run test:run -- src/__tests__/search/fts.test.ts
```

Python tests, after adding pytest configuration:

```bash
python -m pytest workers/python/tests/test_rag_index_lock_and_bulk.py
python -m pytest workers/python/tests/test_convert_image_policy.py
```

Manual large-document verification:

```text
1. Upload a graph-mode PDF larger than 20MB.
2. Confirm document reaches basic ready before graph completes.
3. Run keyword search for a known phrase.
4. Run semantic search for a known answer.
5. Confirm graph status shows running.
6. Wait for graph completion.
7. Run graph-enhanced search and verify expected entity/source chunks.
8. Confirm task metrics show stage timings.
```

---

## 15. Performance Targets

These targets are quality-preserving and staged.

| Stage | Target | Notes |
|---|---:|---|
| Basic retrieval ready for large docs | minutes to under 60s where provider limits allow | Depends on embedding API throughput and chunk count |
| SQLite embedding DB write | 3s to 20s depending chunk count | Must be measured against real SQLite file and vector size |
| LightRAG basic insert | materially faster than serial | Bulk enabled only after compatibility proof |
| Full graph indexing for 10k chunks | no fixed 45s target | LLM extraction is provider-bound; correctness wins |
| Semantic split for huge docs | under 10s without LLM timeout | Achieved by bounded structural/sentence split, not quality shortcuts |
| PDF conversion | faster via important-image filtering | Must preserve significant figures and diagrams |

---

## 16. Explicit Non-Goals

These are intentionally out of scope for this implementation:

1. Replacing LightRAG with a different RAG system.
2. Adding a new external vector database before measuring current bottlenecks.
3. Making graph indexing appear complete before it is complete.
4. Defaulting large documents to text-only mode.
5. Increasing chunk size merely to reduce chunk count.
6. Removing LLM semantic splitting from normal-size high-precision workflows.
7. Trusting speed metrics without retrieval quality gates.

---

## 17. Self-Review Checklist

- [ ] Every proposed speedup has a quality gate.
- [ ] `ready` semantics are precise.
- [ ] Graph status is separate from document status.
- [ ] Required DB/file artifacts are awaited before ready.
- [ ] Embedding order is explicit and test-covered.
- [ ] LightRAG bulk insert has fallback and validation.
- [ ] Splitter changes preserve sentence/table/code/heading boundaries.
- [ ] Image extraction keeps important visuals by default.
- [ ] Tests cover failure paths: 429, timeout, SQLite busy, partial graph failure, lock cleanup.
- [ ] UI copy does not overpromise graph readiness.

---

## 18. Final Recommendation

Approve this plan in phases, not as one large rewrite.

The highest-confidence, lowest-risk wins are:

1. Explicit chunk order for embeddings.
2. Awaited transaction batching for DB embedding writes.
3. Two-stage readiness with graph status.
4. LightRAG indexing lock.

The highest-risk changes must stay guarded until quality tests prove them safe:

1. LightRAG bulk insert.
2. Large-document split strategy changes.
3. Selective image extraction thresholds.

The product goal should be stated as:

```text
Make large documents available for accurate basic retrieval as early as possible,
while graph indexing continues truthfully in the background.
```

That goal improves perceived speed without sacrificing document quality or retrieval precision.
