# 大文档 LLM 领域分段与 Graph/Wiki 加速 —— 最终优化设计方案

日期：2026-06-28
状态：**最终设计方案（Final）**，用于直接指导后续 AI / 开发者实施
范围：在不改变前端主交互的前提下，解决"大文档被 embedding 窗口切成海量小碎片，导致 Graph/Wiki 极慢且碎片化"的核心瓶颈

---

## 0. 阅读指南（给实施者 / AI）

本文档是**实施手册**，不是讨论稿。每一节都标注了：

- `[FACT]`：已通过代码核实的当前事实（带 `文件:行号`，可在实施前复核）
- `[P0/P1/P2]`：优先级
- `[MUST]`：硬性约束，违反会导致数据错乱或质量倒退
- `[VERIFY]`：实施前必须先验证的假设
- ⚠️：风险点或与初版直觉相反的结论

**实施顺序务必遵循 §12（实施路线图）**，按"收益/风险比"从高到低推进，不要跳级。

---

## 1. 最高设计原则（所有决策的裁决依据）

优先级从高到低，冲突时高者优先：

```
1. 保证质量      —— 不为减少调用次数牺牲 Wiki/Graph 质量
2. 提升效率      —— 不为加速牺牲实体/关系抽取质量
3. 提升用户体验  —— 基础检索尽快可用；增强阶段失败不阻塞
4. 降低认知负担  —— 用户不选文档类型、不配并发、不懂 chunk/segment
```

工程约束：

- 通用：面向多语言、多文档类型（科研论文 / 法律合同 / 财报 / 运维手册 / 混合拼接文档……），**禁止把任何固定 taxonomy 写成规则**。
- 鲁棒：Graph/Wiki 是增强阶段，**失败必须可降级到基础检索**，不让整篇文档不可用。
- 可验证：每个 PR 都要有度量指标（§13），用数据而非感觉判断成败。

---

## 2. 问题诊断（已用代码核实）

### 2.1 根因：一个尺寸服务了两个目标 `[FACT]`

当前 `DocumentChunk` 同时承担：

```
embedding / FTS / RAG 检索   ←  需要小粒度
Wiki extraction 输入         ←  需要大上下文
LightRAG Graph 抽取输入      ←  需要中等粒度 + 上下文前缀
```

而 chunk 大小**完全由 embedding 模型窗口决定**：

`[FACT]` `src/lib/documents/pipeline.ts:206-207`
```ts
const embedContext = (embedModel?.contextWindow || 0) > 0 ? embedModel!.contextWindow : 8192;
const chunkMaxTokens = Math.floor(embedContext * splitRatio); // splitRatio 默认 0.9
```

→ 默认 `chunkMaxTokens ≈ 7370`（8192 × 0.9）。1000 页文档被切成 **100–300+ 个**检索级小片。

### 2.2 Wiki 慢且碎片化 `[FACT]`

`[FACT]` `src/lib/wiki/synthesizer.ts` Phase A：**每个 chunk 一次 LLM extraction 调用**。
`[FACT]` `src/lib/wiki/types.ts:100`：`chunkMaxTokens: 2000` —— Wiki 还会**二次截断**到 2000 token，浪费现代 LLM 上下文。

后果：300 chunk = 300 次 LLM 调用；碎片化输入导致同一主题被反复抽取 → merge/fusion 阶段爆炸，条目细碎重复。

并发现状（非纯串行）：`[FACT]` `extractSchedulerConcurrency=16`，受 `AdaptiveLimiter` + `WIKI_EXTRACT_CONCURRENCY` 控制。所以 Segment 化对 Wiki 的主要收益**不是"串行变并发"**，而是：减少输入单元数、提升单单元上下文完整性、降低重复抽取。

### 2.3 Graph 慢的三个真实原因 `[FACT]` ⚠️

⚠️ **注意：Graph 慢不是因为"chunk 太多"，与初版直觉相反。** 详见 §4 的业界证据。

真实原因：
1. `[FACT]` **15 分钟硬 timeout**：`src/lib/documents/pipeline.ts:616`
   ```ts
   const timeoutMs = indexMode === "graph" ? 900_000 : 300_000;
   ```
   大文档跑到一半可能被杀，表现为"超慢/失败"，实际是 timeout 截断。
2. `[FACT]` **逐 chunk 串行 LLM 调用**：`workers/python/rag_index.py:189` 注释 *"processes each chunk individually"*，graph 模式默认 `force_serial`（`rag_index.py:530`）。
3. **chunk 缺乏上下文**：碎片化、无所属领域信息，LLM 抽到无意义实体，merge 阶段堆积垃圾。

### 2.4 一句话总结

> 检索单元（chunk）被错误地复用为理解单元（Wiki/Graph 输入）。需要解耦，但 **Wiki 和 Graph 的最优输入策略方向相反**（见 §4）。

---

## 3. 目标架构：三层解耦

```
DocumentAtom      原始可定位结构单元（坐标系，持久化的 AtomicSpan）
    ↓
DocumentSegment   LLM 归纳的领域/主题单元（Wiki 主输入）
    ↓
DocumentChunk     embedding/FTS/RAG 检索单元（Graph 主输入，需附上下文前缀）
```

核心原则：

```
小 chunk 用于检索。
大 segment 用于 Wiki 理解。
Graph 用中等 chunk + 上下文前缀（Contextual Retrieval 思想）。
LLM 主导领域分段；结构规则只做压缩、候选边界、定位、校验。
```

---

## 4. ⚠️ 关键修正：Wiki 与 Graph 必须采用相反策略

这是本方案相对初版设计文档的**最重要修正**，基于业界证据：

### 4.1 业界证据（Graph 要小 chunk）

| 来源 | 结论 |
|---|---|
| Microsoft GraphRAG 默认数据流 | 默认 **1200 tokens**；明确："Larger chunks result in lower-fidelity output and fewer entities" |
| Zep（图构建文档） | 推荐 **≤500 字符**，以捕获细粒度实体和关系 |
| Demystifying GraphRAG | 小 chunk 抽取的实体引用约为 4× 大 chunk 的 **2 倍** |
| LightRAG 行为 | **单遍抽取、无 gleaning**；对 chunk 大小比 GraphRAG 更敏感——大 chunk 漏掉的实体没有第二次机会补回 |

**机制**：Graph extraction 的瓶颈不是"读多少上下文"，而是"LLM 单次调用能稳定抽出多少实体"。塞进 32K tokens 会因注意力稀释漏掉大量实体。

### 4.2 业界证据（Wiki/理解要大上下文）

Wiki 要"理解并综合"，大上下文减少碎片、提升条目完整性。这部分初版方案正确。

### 4.3 因此 Graph 不能盲目用大 Segment

初版方案（§11.2）假设"把 300 个小 chunk 换成 30 个大 Segment 喂 LightRAG = 更快更好"，**这个方向对 Graph 是错的**。

### 4.4 正确策略：Contextual Retrieval（Anthropic 思想）

Graph 的解法不是放大 chunk，而是**给小/中 chunk 注入它所属 Segment 的摘要作为前缀**：

```
[领域上下文：本片段属于「系统架构」领域]
[Segment 摘要：本段描述服务依赖与部署拓扑……]
[所属标题路径：第三章 > 3.2 微服务划分]
---
[chunk 原文内容]
```

效果：
- 保留小 chunk 的实体抽取精度（800–1500 tokens）；
- 恢复被切碎丢失的上下文，减少无意义实体；
- LightRAG 单遍抽取质量显著提升。

Wiki 用大 Segment；Graph 用"小 chunk + contextual prefix"。**两者加速逻辑本质不同，不该共用同一个 Segment 输入抽象。**

---

## 5. DocumentAtom 设计（复用 AtomicSpan）

### 5.1 定位

`DocumentAtom` = 持久化、增强版的 `AtomicSpan`。职责**不是分段**，而是：
1. 为 LLM 分段提供结构地图；
2. 为边界提供稳定坐标（`startAtomIndex / endAtomIndex`）；
3. 为 Segment / Chunk / 引用建立映射；
4. 避免 LLM 猜页码或猜位置。

### 5.2 现有基础 `[FACT]`

`[FACT]` `src/lib/documents/outline/spans.ts` 已有 `buildAtomicSpans(markdown): AtomicSpan[]`，支持 heading/paragraph/table/code/list/other + tokenCount + headingLevel + stable id。测试见 `src/__tests__/documents/outline/spans.test.ts`。

`[FACT]` `src/lib/documents/outline/macro-split.ts` 的 `splitByMacroAST()` 已有对 Docling heading 误判、代码块内 `#` 注释、整句误判为标题的防御逻辑，**必须吸收过来**，不要重写 parser。

### 5.3 Schema `[P1]`

```prisma
model DocumentAtom {
  id           String   @id @default(uuid())
  documentId   String   @map("document_id")
  index        Int
  spanId       String?  @map("span_id")       // 对应 AtomicSpan.id (s_0000)
  blockType    String                            // heading|paragraph|table|code|list|other|unknown
  content      String
  tokenCount   Int?     @map("token_count")
  headingPath  String?  @map("heading_path")
  headingLevel Int?     @map("heading_level")
  pageStart    Int?     @map("page_start")     // 来自 structure.json，PDF 可靠，DOCX 可能缺失
  pageEnd      Int?     @map("page_end")
  charStart    Int?     @map("char_start")     // 主边界坐标，文档类型无关
  charEnd      Int?     @map("char_end")
  createdAt    DateTime @default(now()) @map("created_at")

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, index])
  @@map("document_atoms")
}
```

### 5.4 实现要求 `[MUST]`

- 优先复用 `buildAtomicSpans()`；吸收 `splitByMacroAST()` 的 Docling 防误判逻辑。
- 结合 `structure.json` 回填 page / headingPath。
- **页码只是展示 metadata，不是边界真相**。`charStart/charEnd` 和 `atom index` 是主边界坐标。DOCX 页码不可靠时仍以 atom index 为准。
- reprocess 时 `deleteMany({ where: { documentId } })` 后重建。

---

## 6. DocumentSegment 设计（Wiki 主输入）

### 6.1 定位

LLM 从当前文档**自身归纳**出的领域/主题单元（不是固定 taxonomy）。是 Wiki 的主输入；Graph 的上下文来源。

### 6.2 Schema `[P1]`

```prisma
model DocumentSegment {
  id                 String   @id @default(uuid())
  documentId         String   @map("document_id")
  index              Int
  title              String
  summary            String?                            // ≤300 字，作为 Graph chunk 的上下文前缀
  startAtomIndex     Int       @map("start_atom_index")
  endAtomIndex       Int       @map("end_atom_index")   // 闭区间
  pageStart          Int?      @map("page_start")
  pageEnd            Int?      @map("page_end")
  headingPath        String?   @map("heading_path")
  tokenCount         Int?      @map("token_count")
  contentPath        String?   @map("content_path")     // 大内容落文件，DB 只存路径
  sourceAtomIds      String    @default("[]") @map("source_atom_ids")    // JSON
  sourceChunkIds     String?   @map("source_chunk_ids") // JSON，必须在 oversize re-split 之后填充（见 §7.3）
  segmentationMethod String    @default("llm")          // llm|hybrid|fallback
  segmentationReason String?   @map("segmentation_reason")
  confidence         Float     @default(0.8)
  contentHash        String?   @map("content_hash")     // reprocess 增量判断用（见 §11.2）
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, index])
  @@map("document_segments")
}
```

### 6.3 字段说明

- `startAtomIndex / endAtomIndex`：**最终边界真相**，闭区间，落在 Atom 边界上。
- `summary`：Graph contextual prefix 的来源，**必须生成**。
- `contentPath`：大内容（>16KB）落文件，避免 DB 膨胀。
- `sourceChunkIds`：**P0 时序约束**（见 §7.3）。

---

## 7. DocumentChunk 不变，但有两条硬约束

`DocumentChunk` 继续作为 embedding/FTS/RAG 检索单元，**Schema 不变**，大小仍受 embedding 窗口限制。`[FACT]` 现有 schema `prisma/schema.prisma:142` 已有 id/index/title/content/tokenCount/startPage/endPage/headingPath/embedding/embedModel。

### 7.1 现有 oversize re-split `[FACT]`

`[FACT]` `src/lib/documents/pipeline.ts` 的 `embedDocumentChunks()` 会在 embedding 前检查 oversize chunk，**deleteMany + createMany 替换** chunk 行（约 pipeline.ts:330-355）。这意味着 chunk id 在 embedding 阶段会变。

### 7.2 `[MUST]` Graph contextual prefix

Graph 模式下，每个 chunk 写入 `graph_chunks/` 目录前，**注入所属 Segment 的上下文前缀**：

```
[Context: Segment "{title}"]
{segment.summary}

[Section: {headingPath}]
---
{chunk.content}
```

实际写入 LightRAG 的 chunk 文件名仍用 `chunk_000.md`（见 §9.1）。

### 7.3 `[MUST]` P0 时序约束：sourceChunkIds 必须最后建

```
正确顺序：
  1. splitAndPersistChunks()        → DocumentChunk（初步）
  2. embedDocumentChunks()          → oversize re-split，chunk id 变化
  3. 此时 chunk 表稳定
  4. 回填 DocumentSegment.sourceChunkIds
```

**若在 step 1 之后、step 2 之前建 sourceChunkIds，会因 re-split 产生失效引用。** 这是初版文档已识别的真坑，必须遵守。

---

## 8. LLM-guided 领域分段引擎（正式主路径）

### 8.1 为什么不用纯规则分段

纯规则（按章节切）会在科研论文、法律合同、混合拼接文档上失败，且无法做主题归纳。本方案采用 **LLM-guided Hierarchical Domain Segmentation**，结构规则只做输入压缩、候选边界、定位、校验。

### 8.2 主流程

```
full markdown / structure.json
  → buildAtomicSpans / DocumentAtom            （本地，无 LLM）
  → buildWindowSignatures                      （本地，无 LLM）
  → detectCandidateBoundaries                  （本地，无 LLM）
  → LLM global segmentation planning           （1 次 LLM，读结构地图）
  → local boundary refinement                  （边界附近读少量原文，≤K 次 LLM）
  → deterministic validation                   （本地，无 LLM）
  → persist DocumentSegment
```

### 8.3 成本模型（1000 页文档示例）

| 步骤 | LLM 调用 | 输入 tokens |
|---|---|---|
| WindowSignature | 0（默认本地生成） | — |
| global planning | 1 | ~10–15K（100 windows × 100–150 tokens） |
| local refinement | ≤15（每个边界） | ~5K × 15 = 75K |

**总计 ~1 次 planning + 少量 refinement，远低于 Wiki/Graph 对 100+ chunk 逐个抽取的成本，且只发生一次。**

### 8.4 `[MUST]` WindowSignature 默认本地生成

```
不要默认每个 window 都调 LLM summary。
仅在结构信号不足 / 低置信度 / 需增强时，对 selected windows 调 LLM。
```

否则分段本身变成新的成本黑洞。

### 8.5 LLM planning 输入

```
window signatures（token 统计、关键词、首句预览）
heading paths
candidate boundaries
token statistics
selected previews（仅低置信度区域）
```

### 8.6 LLM planning 输出（JSON）

```json
{
  "documentType": "mixed technical dossier",
  "language": "mixed zh/en",
  "segmentationStrategy": "domain-based",
  "segments": [
    {
      "title": "Architecture",
      "startWindowIndex": 2,
      "endWindowIndex": 8,
      "startAtomHint": 120,
      "endAtomHint": 480,
      "reason": "...",
      "confidence": 0.9
    }
  ]
}
```

⚠️ **LLM 输出不是最终真相**。`startAtomHint/endAtomHint` 必须经 local refinement 落到真实 Atom 边界，再经 deterministic validation。

---

## 9. Graph / LightRAG 优化（与 Wiki 策略分离）⚠️

Graph 是风险最高阶段。**核心策略：保持小/中 chunk，注入 Segment 上下文前缀，而不是放大 chunk。**

### 9.1 `[FACT]` Graph 输入目录命名约束

`[FACT]` `workers/python/rag_index.py:164`：`f.startswith("chunk_") and f.endswith(".md")` —— Python **只认 `chunk_*.md`**。

`[MUST]` Graph 专用目录仍用 `chunk_000.md` 命名（内容是加了 contextual prefix 的 chunk），**不要改成 `segment_*.md`**，否则要同步改 Python 文件筛选、排序、id 构造（`f"{doc_id}/{f.replace('.md','')}"`）、清理逻辑和所有测试。

### 9.2 `[MUST]` chunk 大小（Graph）

保持 **800–1500 tokens**（对齐 GraphRAG 默认 1200）。不要为了"减少单元数"放大到 16K+。

### 9.3 `[P0]` Python timeout 配置化 `[MUST]`

`[FACT]` `src/lib/documents/pipeline.ts:616` 硬编码 `900_000`。

`[MUST]` 必须在切换 Graph 策略前先做：
1. 新增环境变量并读取：
   ```env
   GRAPH_PYTHON_INDEX_TIMEOUT_MS=14400000   # 4h，与 queue 层 rag_index timeout 对齐
   ```
2. `indexWithLightRAG()` 不再硬编码 900_000。
3. 记录 timeout 是否发生（resultData 加 `timeoutOccurred`）。
4. `[VERIFY]` **先验证当前 Graph 慢/失败是否本来就是 15min timeout 导致**——这可能是元凶，验证后或许根本不需要大改架构。

### 9.4 `[P0]` embeddings.bin 对齐 `[MUST]`

`[FACT]` 当前 graph 模式复用 retrieval 的 `embeddings.bin`（pipeline.ts:`hasCachedEmbeddings`）。

`[MUST]` **Graph contextual prefix 模式下，不得复用 retrieval 的 embeddings.bin**——因为加了前缀的 graph chunk 文本与 retrieval chunk 文本不同，embedding 会错位。

MVP 推荐：**Graph contextual 模式不传 embeddingsFile，让 LightRAG 对 graph_chunks 重新 embedding。**

未来优化（非 MVP）：
```
graph_embeddings.bin
graph_embedding_manifest.json   // 与 graph_chunks/chunk_*.md 严格一一对应
```

### 9.5 `[P0]` LightRAG id 与清理 `[VERIFY]`

必须确认并测试：
- graph chunk id 是否仍以 `docId/chunk_...` 形式进入 LightRAG（`rag_index.py:521`）；
- reprocess 是否删除旧 graph chunk 对应的 LightRAG 数据（`rag_index.py:498-509` 的 `adelete_by_doc_id` 循环）；
- document delete 是否清理 `graph_chunks/` 目录；
- cleanup 是否识别 `graph_chunks/` 目录；
- Graph 查询和 UI 不依赖旧 chunk 文件含义。

### 9.6 `[P2]` 可选：gleaning 式增强

LightRAG 单遍抽取无 gleaning。若实体覆盖率不足，可考虑：对高价值 Segment 做一次"补抽"pass（仅低置信度 Segment），但**这是 P2，先验证 §9.3 timeout 是否元凶**。

---

## 10. Wiki 优化设计

### 10.1 `[P0]` MVP：去掉固定 2000 token 上限

`[FACT]` `src/lib/wiki/types.ts:100`：`chunkMaxTokens: 2000`，且 `synthesizer.ts:294` `truncateToTokens(chunk.content, 2000)`。

改为基于 `writingModel.contextWindow` 动态计算：

```ts
wikiInputMaxTokens = clamp(
  floor(writingModel.contextWindow * 0.08),   // 起步保守
  4000,
  16000                                        // 上限先卡 16K，观察 JSON invalid rate 再放大
)
```

`[MUST]` 保守起步的理由：Wiki extraction 输出结构化 JSON，输入过大会增加 JSON invalid rate 和延迟。先 16K，根据 §13 指标调整。

此 PR **不改 DB、不改 Graph、不改分段**，是最低风险的立竿见影优化。

### 10.2 Segment 输入

Wiki 从 `DocumentChunk[]` 切换为 `DocumentSegment[]`。

```
主路径：DocumentSegment[]
fallback：DocumentSegment 不存在 / 旧文档 / 失败 → DocumentChunk[]
```

fallback 仅兼容路径，不是主路径。

### 10.3 `[MUST]` checkpoint 升级 v2

`[FACT]` 当前 checkpoint 基于 `lastProcessedChunkIndex`（synthesizer.ts）。

升级为：
```json
{
  "schema": "wiki_progress_v2",
  "unitType": "segment",
  "lastProcessedUnitIndex": 3,
  "microSummaries": [],
  "totalUnits": 10
}
```

`[MUST]` 避免旧 chunk checkpoint 与 segment checkpoint 混用；读 checkpoint 时按 `schema` 字段区分。

### 10.4 `[MUST]` reprocess 时的 segment identity（初版遗漏点）

⚠️ reprocess 时 atom index 重新编号，segment 边界会变。若 wiki checkpoint 按 segmentIndex 存，**reprocess 后全部失效**。

策略：
- reprocess 触发时，**清空 wiki checkpoint v2**（视为全新文档）；
- DocumentSegment 加 `contentHash` 字段，未来可用于增量（仅内容变化的 segment 重跑），但 **MVP 阶段不实现增量，全量重跑**。

### 10.5 sourceRef 升级

`[FACT]` 当前 `WikiSourceRef`（types.ts:28）：`{documentId, chunkId?, chunkIndex?, entityId?}`。

扩展为：
```ts
WikiSourceRef {
  documentId: string
  segmentId?: string
  segmentIndex?: number
  chunkId?: string
  chunkIndex?: number
  startAtomIndex?: number
  endAtomIndex?: number
  sourceChunkIds?: string[]
}
```

保证 Wiki 条目可回溯到 Atom/Chunk/Segment。

---

## 11. 任务流、生命周期、清理

### 11.1 `[FACT]` 当前任务链

```
document_convert (Docling convert + split + persist chunks)
  → rag_embed_index (embed + oversize re-split + FTS; 提交 wiki_synthesize + rag_index 并行)
      → wiki_synthesize (并行)
      → rag_index (graph 模式，document-graph-worker)
```

`[FACT]` `rag-embed-index-worker.ts:73-82`：Wiki 在 embed 完成后**立即并行提交**（不等 graph），用户体验好。
`[FACT]` `document-graph-worker.ts:88`：graph 完成才 `status=ready`。

### 11.2 `[P0]` 新增 `document_segment` 任务

新增任务类型 `"document_segment"`：

`[MUST]` 修改：
- `src/lib/queue/types.ts`：`TaskType` 加 `"document_segment"`
- `src/lib/queue/index.ts`：注册 worker
- 新建 `src/lib/queue/workers/document-segment-worker.ts`

推荐配置：
```env
QUEUE_DOCUMENT_SEGMENT_CONCURRENCY=1
DOCUMENT_SEGMENT_TIMEOUT_MS=1800000   # 30min
```

`[MUST]` 纳入 follow-up 取消：`[FACT]` `src/lib/documents/processing-tasks.ts:113` `cancelActiveFollowupTasks` 当前 `type: { in: ["rag_index", "wiki_synthesize"] }`，**必须加 `"document_segment"`**。

### 11.3 `[P0]` 任务链重构（关键 UX 决策）

⚠️ **不要让 wiki_synthesize 等 document_segment 完成才启动**，否则违反原则 3（用户体验），延长用户看到 Wiki 的时间。

推荐任务链：

```
document_convert
  → Docling convert → markdown + structure.json
  → build DocumentAtom
  → retrieval chunking → persist DocumentChunk

rag_embed_index
  → embedding → oversize chunk finalization
  → FTS → 基础检索可用
  → 并行提交: document_segment, wiki_synthesize, (graph ? rag_index)

document_segment   （与 wiki 并行）
  → WindowSignature → candidate boundaries → LLM planning → refinement → validation
  → persist DocumentSegment
  → 回填 sourceChunkIds
  → 生成 Graph contextual prefix chunks（写 graph_chunks/）
  → 触发 rag_index（graph）使用 graph_chunks/

wiki_synthesize    （与 segment 并行）
  → 优先 DocumentSegment[]，缺失则 fallback DocumentChunk[]

rag_index (graph)
  → 读 graph_chunks/chunk_*.md（带 contextual prefix）
  → 不复用 retrieval embeddings.bin
```

**关键点**：
- `document_segment` 与 `wiki_synthesize` **并行**。Wiki 先用 chunk 跑（fallback），segment 就绪后**不重启 wiki**（MVP 不做无缝切换，避免复杂性）。
- 正常成功路径由 `document_segment` 触发 graph（用 contextual chunks）；fallback 仅失败恢复。

### 11.4 `[P0]` status 语义重定义（独立、零风险，可最先做）

`[FACT]` 当前 `document.status="ready"` 依赖 graph 完成。

`[MUST]` 重定义：
```
status="ready"  表示 基础检索可用（embed + FTS 完成）
Graph/Wiki/Segment 通过 asyncTask branch 展示增强状态
```

如果暂不改 UI，至少在任务进度中展示：
```
正在分析文档主题结构
正在基于主题片段生成 Wiki
正在基于主题片段构建知识图谱
```

`[MUST]` 这项**独立于分段，纯 UX 收益、零风险，建议作为第一个 PR**。

### 11.5 清理 / reprocess / delete `[MUST]`

新增 Atom / Segment 后同步处理：
- reprocess：取消旧 `document_segment` / `wiki_synthesize` / `rag_index`；删除旧 atoms / segments / graph_chunks；
- 删除文档：清理 atoms / segments DB rows + segment 文件 + graph_chunks 目录；
- cleanup：识别 `graph_chunks/` 目录；
- 旧文档：无 segments 时 wiki/graph fallback chunks。

---

## 12. 实施路线图（按收益/风险比排序）

⚠️ **务必按此顺序**。每个 PR 独立可验证、可回滚。目标架构始终是 Atom → Segment → Chunk，分 PR 是质量保证措施。

### PR 1 `[P0]` 零风险速赢（建议立即做）

包含两件独立、零架构改动的事：
1. **Wiki 去固定 2000 token 上限**（§10.1）：动态计算 wikiInputMaxTokens，不改 DB，不改 Graph，补测试。
2. **status 语义重定义**（§11.4）：`ready` = 基础检索可用，增强阶段走 asyncTask branch。

验收：Wiki JSON invalid rate 不上升；用户更快看到"可用"状态。

### PR 2 `[P0]` Graph timeout 排查与配置化（§9.3）

1. 新增 `GRAPH_PYTHON_INDEX_TIMEOUT_MS`，`indexWithLightRAG()` 不再硬编码。
2. `[VERIFY]` **验证当前 Graph 慢/失败是否本来就是 15min timeout 导致**。
3. resultData 加 `timeoutOccurred`。

验收：大文档 graph 不再因 15min 被杀；明确 timeout 与架构问题的占比。

⚠️ **如果 PR 2 验证发现 timeout 是元凶，PR 3–6 的优先级需重新评估**——可能 Graph 根本不需要 Segment 化，只需要修 timeout + 加 contextual prefix（§9.2）。

### PR 3 `[P1]` DocumentAtom persistence（§5）

- 复用 `buildAtomicSpans`，吸收 `splitByMacroAST` Docling 防误判；
- 加 headingPath / char offsets / page metadata；
- 新增 `DocumentAtom` schema + migration；
- 在 `document_convert` 中持久化 atoms；
- 补 Atom tests。

验收：不改变任何现有行为；atom 覆盖全文、无重叠、坐标稳定。

### PR 4 `[P1]` LLM-guided segmentation 闭环（§8）

- build window signatures（本地）；
- candidate boundaries（本地）；
- LLM planning + local refinement + validation；
- persist `DocumentSegment`；
- **此 PR 不接 Wiki/Graph**，先验证 segment coverage / token 分布 / 质量。

验收（§13.1 指标）：segment 主题一致、边界可解释、覆盖全文无空洞。

### PR 5 `[P2]` Wiki 使用 DocumentSegment（§10.2–10.5）

- Wiki 优先读 segments，fallback chunks；
- checkpoint v2（§10.3）；
- sourceRef 升级（§10.5）；
- reprocess 清空 checkpoint（§10.4）。

验收（§13.2 指标）：inputUnitCount 显著下降；条目更完整不碎片化；耗时不增。

### PR 6 `[P3]` Graph 使用 contextual prefix chunks（§9）⚠️

⚠️ **不是用大 Segment，而是小 chunk + Segment 上下文前缀**：
- document_segment 生成 `graph_chunks/chunk_*.md`（带 §7.2 前缀）；
- graph worker 读 `graph_chunks/`；
- 禁用 retrieval embeddings.bin 复用（§9.4）；
- cleanup/reprocess 支持 `graph_chunks/`（§9.5、§11.5）。

验收（§13.3 指标）：实体/关系质量不下降（甚至上升）；耗时下降或质量显著提升且耗时可接受。

---

## 13. 度量指标（每个 PR 都要用数据验收）

### 13.1 Segmentation metrics（PR 4）

```
atomCount
windowCount
candidateBoundaryCount
segmentCount
segmentTokenAvg / P50 / P90 / Max
llmPlanningTokens
boundaryRefinementCalls
segmentationMs
fallbackUsed
coverageRate          // segment 覆盖的 atom / 总 atom，必须 = 1.0
```

### 13.2 Wiki metrics（PR 1, PR 5）

```
inputUnitType         // segment | chunk
inputUnitCount
avgInputTokens
extractionMs / mergeMs / summaryMs
fusionCalls
failedUnits
jsonRepairRetries / jsonRepairFailures
```

### 13.3 Graph metrics（PR 2, PR 6）

```
inputUnitType         // chunk(contextual) | chunk
inputUnitCount
avgInputTokens
graphInsertMs
llmCalls
connectionRetries
timeoutOccurred       // P0，PR 2 引入
failedUnits
entitiesCount
relationsCount
```

---

## 14. 验收标准

### 14.1 质量

```
Segment 主题一致，边界可解释；
Wiki 条目更完整，不碎片化；
Graph 实体/关系质量不下降（小 chunk + 上下文前缀后应提升）；
引用可回溯到 Atom / Chunk / Segment；
多语言、多类型文档可自动分段。
```

### 14.2 效率

```
DocumentChunk 100+ 的大文档，生成明显更少的 Segment（Wiki 用）；
Wiki input unit count 显著下降；
Graph 不因 chunk 数量爆炸（保持小 chunk，但消除无意义实体导致的 merge 爆炸）；
Wiki/Graph 总耗时下降，或质量显著提升且耗时可接受。
```

### 14.3 用户体验

```
上传 → 开始处理 → 跳转文档库流程不变；
基础检索可用时间不明显变慢（status=ready 提前）；
Graph/Wiki 失败不导致文档整体不可用；
用户不需要选择文档类型或分段边界。
```

---

## 15. Deterministic Validation（所有 segment 必须校验）

```
1. 按 atom index 顺序排列；
2. 不重叠；
3. 不出现主体内容空洞（coverageRate = 1.0）；
4. startAtomIndex/endAtomIndex 合法；
5. pageStart/pageEnd 由 Atom 自动计算；
6. tokenCount 不超过任务上限；
7. 太大 segment 拆 SegmentPart（仅 Wiki 输入拆分，Graph 用原 chunk+前缀）；
8. 太小 segment 合并到相邻语义段；
9. 低 confidence 需局部精修或 fallback；
10. JSON invalid 需 repair/retry；
11. 失败时使用已有 Atom/Chunk 兼容路径。
```

---

## 16. 通用性要求（面向大众文档）

系统必须适配：中文项目方案、英文技术白皮书、中英混合文档、科研论文、法律合同、财务报告、医学指南、培训教材、运维手册、API 文档、招投标文件、多份资料拼接的大文档。

`[MUST]` 禁止把以下内容作为系统假设（只能作为 LLM prompt 里的示例）：
```
产品方案/实施方案/培训方案
Introduction/Methods/Results
Definitions/Payment/Liability
```

LLM 必须从当前文档自身归纳 `documentType / language / candidateDomains`。

---

## 17. 最终结论与决策摘要

### 17.1 核心方向（成立）

> 复用 `buildAtomicSpans / AtomicSpan` 构建 `DocumentAtom`；让 LLM 读取压缩后的结构地图主导多语言、多类型文档的领域分段；精修校验为 `DocumentSegment`；保留 `DocumentChunk` 作为检索单元。

### 17.2 相对初版的关键修正（⚠️ 必须遵守）

| 维度 | 初版假设 | 最终修正 | 依据 |
|---|---|---|---|
| **Graph 输入** | 大 Segment 更快更好 | **小 chunk(800–1500tok) + Segment 上下文前缀** | GraphRAG 默认 1200tok；Zep ≤500 字符；LightRAG 单遍无 gleaning |
| **Wiki vs Graph 策略** | 共用 Segment 抽象 | **方向相反，分别设计** | Wiki 要理解(大)，Graph 要抽取精度(小) |
| **任务链** | segment 完成才提交 wiki | **segment 与 wiki 并行**，wiki 先 fallback chunk | 用户体验原则 |
| **reprocess** | 未讨论 segment identity | **清空 wiki checkpoint v2，MVP 全量重跑** | atom index 重编号 |
| **实施首步** | Wiki 上限 | **Wiki 上限 + status 语义 + Graph timeout 排查** | timeout 可能是元凶 |

### 17.3 一句话

**Wiki 走大 Segment 路线；Graph 走"小 chunk + contextual prefix"路线；两者加速逻辑本质不同，不该共用同一个输入抽象。先修 timeout 和 Wiki 上限（零风险速赢），再验证 Graph 是否真需要架构改动。**

---

## 附录 A：实施前必做的代码复核清单

实施者动手前，先打开这些文件确认 `[FACT]` 仍然成立（代码会变）：

```
src/lib/documents/pipeline.ts:206-207    chunkMaxTokens 计算
src/lib/documents/pipeline.ts:616        Graph 900_000 timeout
src/lib/documents/pipeline.ts:330-355    embedDocumentChunks oversize re-split
src/lib/wiki/types.ts:100                WIKI_CONFIG.chunkMaxTokens = 2000
src/lib/wiki/synthesizer.ts:294          truncateToTokens(chunk.content, 2000)
src/lib/queue/workers/rag-embed-index-worker.ts:73-82   wiki 并行提交
src/lib/queue/workers/document-graph-worker.ts:88       graph 完成才 ready
src/lib/documents/processing-tasks.ts:113               cancelActiveFollowupTasks
src/lib/documents/outline/spans.ts                      buildAtomicSpans
src/lib/documents/outline/macro-split.ts                splitByMacroAST (Docling 防误判)
workers/python/rag_index.py:164                         chunk_*.md 筛选
workers/python/rag_index.py:189-206                     逐 chunk 抽取 + force_serial
prisma/schema.prisma:142                                 DocumentChunk
prisma/schema.prisma:359                                 WikiEntry
src/lib/queue/types.ts:1                                 TaskType
```

## 附录 B：业界参考

- Microsoft GraphRAG 默认数据流（chunk size 1200、gleaning）：https://microsoft.github.io/graphrag/index/default_dataflow/
- Microsoft GraphRAG Methods（实体/关系/claim 抽取）：https://microsoft.github.io/graphrag/index/methods/
- Zep – Chunking Large Documents（图构建 ≤500 字符）：https://help.getzep.com/chunking-large-documents
- Dell – Chunk Twice, Retrieve Once（检索与图谱不同分块策略）：https://infohub.delltechnologies.com/p/chunk-twice-retrieve-once-rag-chunking-strategies-optimized-for-different-content-types/
- Anthropic – Contextual Retrieval（chunk 注入上下文前缀，Graph §9.2 的理论依据）
- Neo4j – Under the Covers with LightRAG Extraction（单遍抽取行为）：https://neo4j.com/blog/developer/under-the-covers-with-lightrag-extraction/
- GraphRAG GitHub #460（entity_extraction prompt 是最大 token 消耗）：https://github.com/microsoft/graphrag/discussions/460
- Firecrawl – Best Chunking Strategies for RAG：https://www.firecrawl.dev/blog/best-chunking-strategies-rag
- arXiv 2501.09940 – Passage Segmentation for RAG：https://arxiv.org/html/2501.09940v1
