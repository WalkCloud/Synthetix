# 大文档 LLM 领域分段与 Graph/Wiki 加速最终优化设计方案

日期：2026-06-28
状态：最终设计方案，用于指导后续 AI/开发者实施
目标：在不改变当前前端主流程的前提下，保证质量、提升效率、提升用户体验，并降低用户认知和学习负担。

---

## 0. 最高设计原则

本方案所有实现决策必须遵守以下优先级：

```text
1. 保证质量
2. 提升效率
3. 提升用户体验
4. 简化用户使用的认知和学习负担
```

对应工程约束：

- 不为了减少调用次数而牺牲 Wiki 条目质量；
- 不为了 Graph 更快而牺牲实体/关系抽取质量；
- 不让用户理解 chunk、segment、embedding、Graph、Wiki 等技术细节；
- 不让用户选择文档类型或手动确认领域边界；
- 不让用户配置每个模型服务商真实并发；
- 不为某一种文档写死规则；
- 不用僵硬结构规则替代 LLM 语义判断；
- 失败时基础检索仍应尽量可用，Graph/Wiki 作为增强阶段可重试、可降级。

本程序面向大众用户和多类型文档，不是面向某一种固定格式文档。因此领域分段必须是通用的、多语言的、多文档类型适配的。

---

## 1. 当前代码事实校正

后续实现必须基于当前代码事实，不得基于虚构能力设计。

### 1.1 当前模型配置事实

当前 `ProcessingOptions` 只有：

```ts
llmModelId?: string;
embedModelId?: string;
```

当前 `resolveProcessingModels()` 只解析：

```text
writingModel
embedModel
```

当前没有正式的：

```text
wikiModel
graphModel
```

因此本方案中 Wiki / Graph 的 LLM contextWindow 默认使用：

```text
writingModel.contextWindow || 200000
```

如未来需要独立 wikiModel / graphModel，必须另行设计 schema、ProcessingOptions 和 UI，不应在当前方案中假设其存在。

---

### 1.2 当前 Wiki 事实

当前 Wiki 并不是纯串行：

- 已有 `WIKI_EXTRACT_CONCURRENCY`，默认调度上限来自 `WIKI_CONFIG.extractSchedulerConcurrency`，当前为 16；
- 实际 provider 并发仍受 `AdaptiveLimiter` 和 `LLM_LIMITER_MAX_REQUESTS` 控制；
- 已有 extraction / merge / summary 阶段进度；
- 已有 `extractionMs`、`mergeMs`、`summaryMs`、`fusionCalls`、`chunksFailed` 等 metrics；
- 已有 checkpoint / resume，当前基于 `lastProcessedChunkIndex`；
- 单 chunk extraction 失败不会中断整篇；
- all chunks failed 才整体失败。

因此，Segment 化对 Wiki 的主要收益不应被描述为“从串行变并发”，而应描述为：

```text
1. 提高输入上下文完整性；
2. 减少碎片化条目；
3. 降低重复 extraction；
4. 降低 merge/fusion 重复成本；
5. 在大文档上减少输入单元数量；
6. 在部分场景提升吞吐，但吞吐收益不是唯一目标。
```

当前 Wiki 仍存在一个明确问题：

```ts
WIKI_CONFIG.chunkMaxTokens = 2000
```

这会浪费现代 LLM 上下文，并可能伤害 Wiki 质量。该问题应作为独立低风险 MVP 优先处理。

---

### 1.3 当前 Graph 事实

当前 Graph 使用 LightRAG，读取 chunk 文件目录：

```text
chunk_000.md
chunk_001.md
...
```

当前 Python `rag_index.py` 的 chunk 文件筛选逻辑只识别 `chunk_*.md`。
因此如果后续 Graph 使用 Segment 输入，Graph 专用目录中也应优先继续使用 `chunk_000.md` 命名，以降低 LightRAG / Python 兼容风险。

当前 `indexWithLightRAG()` 内部 Graph Python 调用 timeout 为：

```ts
900_000 ms // 15 minutes
```

即使 queue 层 `rag_index` timeout 是 4 小时，Python 调用仍可能先被 15 分钟 timeout 杀掉。这个问题必须在 Graph 切换 Segment 前验证和修正。

---

### 1.4 当前 AtomicSpan 原型事实

当前代码已经存在：

```text
src/lib/documents/outline/spans.ts
```

其中包含：

```ts
buildAtomicSpans(markdown)
AtomicSpan
```

`AtomicSpan` 已支持：

```text
heading
paragraph
table
code
list
other
tokenCount
headingLevel
stable span id
```

当前也已有相关测试：

```text
src/__tests__/documents/outline/spans.test.ts
```

因此后续不应从零实现 DocumentAtom parser。
正确方向是：

```text
DocumentAtom = persisted / enriched AtomicSpan
```

同时可复用 `splitByMacroAST()` 中对 Docling heading 误判、code block、table 等更复杂场景的防御逻辑。

---

## 2. 核心问题与目标架构

当前系统将 `DocumentChunk` 同时用于：

```text
embedding
FTS
Wiki extraction
LightRAG Graph extraction
```

而 `DocumentChunk` 大小主要受 embedding 模型窗口限制影响：

```text
chunkMaxTokens = embeddingModel.contextWindow * contextUsage
```

这导致大文档被切成大量检索级小片段，Wiki / Graph 被迫逐个处理碎片。

最终目标架构必须拆成三层：

```text
DocumentAtom
  原始可定位结构单元，作为边界坐标系

DocumentSegment
  LLM 领域 / 主题级处理单元，用于 Wiki / Graph

DocumentChunk
  embedding / FTS / RAG / 引用使用的小粒度检索单元
```

核心原则：

```text
小 chunk 用于检索。
大 segment 用于理解。
LLM 主导领域分段。
结构规则只做输入压缩、候选边界、定位和校验。
```

---

## 3. LLM-guided Domain Segmentation 是正式主路径

本方案不采用“结构规则优先，LLM 后补”的僵硬设计。

正式分段引擎应为：

```text
LLM-guided Hierarchical Domain Segmentation Engine
```

主流程：

```text
full markdown / structure.json
  → buildAtomicSpans / DocumentAtom
  → buildWindowSignatures
  → detectCandidateBoundaries
  → LLM global segmentation planning
  → local boundary refinement
  → deterministic validation
  → persist DocumentSegment
```

职责划分：

| 组件 | 职责 |
|---|---|
| AtomicSpan / DocumentAtom | 提供可定位坐标系 |
| structure.json / headings / TOC | 提供结构信号和候选边界 |
| WindowSignature | 压缩长文档，降低 LLM 输入成本 |
| LLM | 识别文档类型、语言、主题结构，做领域分段规划 |
| local boundary refinement | 在边界附近读取少量原文，精确落到 Atom 边界 |
| deterministic validation | 保证覆盖全文、无重叠、无空洞、不过大、不过小 |

LLM 不应读取 1000 页全文。
LLM 应读取结构地图：

```text
Document outline
Window signatures
Candidate boundaries
Token statistics
Selected previews
```

例如 1000 页文档可压缩为约 100 个 windows，每个 window 100-150 tokens，总输入约 10K-15K tokens，远小于现代 LLM 上下文窗口。

---

## 4. 面向大众文档的通用性要求

系统必须适配多语言、多类型文档，例如：

```text
中文项目方案
英文技术白皮书
中英混合文档
科研论文
法律合同
财务报告
医学指南
培训教材
运维手册
API 文档
招投标文件
多份资料拼接的大文档
```

因此禁止把以下内容作为系统假设：

```text
产品方案 / 实施方案 / 培训方案
Introduction / Methods / Results
Definitions / Payment / Liability
```

这些只能作为示例，不能作为规则。

LLM 应从当前文档自身归纳：

```json
{
  "documentType": "research paper",
  "language": "en",
  "candidateDomains": [
    "Introduction",
    "Related Work",
    "Methods",
    "Experiments",
    "Results",
    "Discussion"
  ]
}
```

或者：

```json
{
  "documentType": "mixed technical dossier",
  "language": "mixed zh/en",
  "candidateDomains": [
    "Architecture",
    "Deployment",
    "Operations",
    "Training",
    "Appendices"
  ]
}
```

---

## 5. DocumentAtom 设计：复用 AtomicSpan

### 5.1 定位

`DocumentAtom` 是持久化、增强版 `AtomicSpan`。

它的职责不是最终分段，而是：

```text
1. 为 LLM 分段提供结构地图；
2. 为边界提供稳定坐标；
3. 为 Segment / Chunk / 引用建立映射；
4. 避免 LLM 猜页码或猜位置。
```

最终边界必须落在：

```text
startAtomIndex / endAtomIndex
```

页码只是可选展示 metadata，不是边界真相。

---

### 5.2 字段建议

```ts
DocumentAtom {
  id: string
  documentId: string
  index: number

  spanId?: string
  blockType: "heading" | "paragraph" | "table" | "code" | "list" | "other" | "unknown"

  content: string
  tokenCount: number

  headingPath?: string
  headingLevel?: number

  pageStart?: number
  pageEnd?: number

  charStart?: number
  charEnd?: number

  textPreview?: string
  keywords?: string // JSON

  createdAt: Date
}
```

### 5.3 重要实现要求

- 优先复用 `buildAtomicSpans()`；
- 可吸收 `splitByMacroAST()` 的 Docling heading 防误判逻辑；
- 结合 `structure.json` 回填 page / headingPath 等 metadata；
- 对 DOCX，页码可能不可靠，必须以 atom index / char offset 作为主边界；
- 对 PDF，page provenance 相对可靠，可用于展示和候选边界。

---

## 6. DocumentSegment 设计

### 6.1 定位

`DocumentSegment` 是 Wiki / Graph 的主输入单元。

它表示：

```text
当前文档自身归纳出的领域 / 主题 / 语义单元
```

不是固定 taxonomy。

---

### 6.2 字段建议

```ts
DocumentSegment {
  id: string
  documentId: string
  index: number

  title: string
  summary?: string

  startAtomIndex: number
  endAtomIndex: number

  pageStart?: number
  pageEnd?: number

  headingPath?: string

  tokenCount: number
  content?: string
  contentPath?: string

  sourceAtomIds?: string // JSON
  sourceChunkIds?: string // JSON, built after final retrieval chunks are stable

  segmentationMethod: "llm" | "hybrid" | "fallback"
  segmentationReason?: string
  confidence?: number

  createdAt: Date
  updatedAt: Date
}
```

大内容建议落文件，DB 保存 metadata 和 `contentPath`。

---

## 7. DocumentChunk 设计

`DocumentChunk` 继续作为 retrieval chunk，用于：

```text
embedding
FTS
RAG retrieval
引用定位
```

`DocumentChunk` 仍受 embedding 模型窗口限制。

重要要求：

```text
Segment-sourceChunkIds 映射必须在 embedding oversize re-split 之后生成或修正。
```

因为当前 `embedDocumentChunks()` 可能在 embedding 前发现 oversize chunks，并删除旧 chunk、创建 replacements。若过早建立 `sourceChunkIds`，会产生失效引用。

---

## 8. 后台任务流设计

### 8.1 用户流程不变

用户流程仍是：

```text
上传文档
  → 点击开始处理
  → 跳转文档库
  → 后台自动处理
```

---

### 8.2 推荐后台任务链

```text
document_convert
  → Docling convert
  → markdown + structure.json
  → build DocumentAtom
  → retrieval chunking
  → persist DocumentChunk

rag_embed_index
  → embedding
  → oversize chunk finalization
  → FTS
  → 基础检索可用
  → submit document_segment

document_segment
  → build WindowSignature
  → detect CandidateBoundary
  → LLM global segmentation planning
  → local boundary refinement
  → validate and persist DocumentSegment
  → submit wiki_synthesize
  → submit rag_index

wiki_synthesize
  → use DocumentSegment

rag_index
  → use graph segment chunks / SegmentPart
```

重要：

```text
rag_embed_index 不应再直接提交 wiki_synthesize / rag_index。
正常成功路径应由 document_segment 提交 Wiki / Graph。
```

Fallback 仅用于失败恢复和旧文档兼容，不是主路径。

---

## 9. 新增 Queue / Task 设计

新增任务类型：

```ts
"document_segment"
```

需要同步修改：

```text
src/lib/queue/types.ts
src/lib/queue/index.ts
src/lib/queue/workers/document-segment-worker.ts
```

推荐配置：

```env
QUEUE_DOCUMENT_SEGMENT_CONCURRENCY=1
DOCUMENT_SEGMENT_TIMEOUT_MS=1800000
```

`document_segment` 应纳入：

- reprocess follow-up cancellation；
- delete cleanup；
- recovery / stale task handling；
- task resultData metrics；
- tests。

---

## 10. Wiki 优化设计

### 10.1 MVP：去掉固定 2000 token 上限

当前固定值：

```ts
WIKI_CONFIG.chunkMaxTokens = 2000
```

应先改为基于 `writingModel.contextWindow` 的动态上限。
为了质量和稳定性，不应一开始过大。

建议初始策略：

```text
wikiInputMaxTokens = clamp(
  floor(writingModel.contextWindow * 0.1~0.2),
  4000,
  16000~32000
)
```

后续可基于 JSON invalid rate、latency、output truncation 再调大。

---

### 10.2 Segment 输入

Wiki 应从：

```text
DocumentChunk[]
```

切换为：

```text
DocumentSegment[]
```

如果 Segment 不存在或文档为旧数据：

```text
fallback DocumentChunk[]
```

但 fallback 只是兼容路径。

---

### 10.3 Wiki checkpoint 升级

当前 checkpoint 基于：

```text
lastProcessedChunkIndex
```

Segment 化后应升级为：

```json
{
  "schema": "wiki_progress_v2",
  "unitType": "segment",
  "lastProcessedUnitIndex": 3,
  "microSummaries": [],
  "totalUnits": 10
}
```

避免旧 chunk checkpoint 与 segment checkpoint 混用。

---

### 10.4 Wiki sourceRef 升级

当前 sourceRef 主要基于：

```text
chunkId
chunkIndex
```

需要扩展为：

```ts
WikiSourceRef {
  documentId: string
  chunkId?: string
  chunkIndex?: number
  segmentId?: string
  segmentIndex?: number
  startAtomIndex?: number
  endAtomIndex?: number
  sourceChunkIds?: string[]
}
```

保证 Wiki 条目可回溯。

---

## 11. Graph / LightRAG 优化设计

Graph 是风险最高阶段，应在 Wiki Segment 化稳定后再切换。

### 11.1 Graph 输入目录

为了兼容当前 `rag_index.py` 的 `chunk_*.md` 读取逻辑，Graph 专用 segment 目录中仍应使用：

```text
graph_segments/chunk_000.md
graph_segments/chunk_001.md
```

但内容是：

```text
DocumentSegment 或 SegmentPart
```

不建议 MVP 阶段改成 `segment_000.md`，否则需要同步改 Python 文件筛选、排序、id 构造和清理测试。

---

### 11.2 SegmentPart

如果 Segment 对 Graph 过大，应拆成：

```text
SegmentPart
```

每个 part 必须携带领域上下文：

```text
[Segment Title]
[Segment Summary]
[Part Index]
[Source Atom Range]
[Heading Path]
[Content]
```

不允许退化为无上下文小碎片。

---

### 11.3 Embedding cache alignment（P0）

当前 `embeddings.bin` 与 retrieval `DocumentChunk` 顺序绑定。

如果 Graph 改用 graph segment chunks，却继续传入 retrieval `embeddings.bin`，会出现 embedding 与文本错位。

必须规定：

```text
Graph 使用 segment / segment part 输入时，不得复用 retrieval chunk 的 embeddings.bin。
```

MVP 推荐：

```text
Graph segment 模式不传 embeddingsFile，让 LightRAG 对 graph segment chunks 重新 embedding。
```

未来如需优化，可新增：

```text
graph_embeddings.bin
graph_embedding_manifest.json
```

该 manifest 必须与 `graph_segments/chunk_*.md` 严格一一对应。

---

### 11.4 LightRAG id 与清理（P0）

必须确认并测试：

- segment graph chunk id 是否仍以 `docId/chunk_...` 形式进入 LightRAG；
- reprocess 是否删除旧 graph segment 对应的 LightRAG 数据；
- document delete 是否清理 graph segment 文件和 LightRAG orphan；
- cleanup 是否识别 graph_segments 目录；
- Graph 查询和 UI 是否不依赖旧 chunk 文件含义。

---

### 11.5 Python Graph timeout（P0）

当前 Graph Python 调用 timeout 为 15 分钟：

```ts
const timeoutMs = indexMode === "graph" ? 900_000 : 300_000;
```

在切换 Graph Segment 前，必须：

```text
1. 将 Graph Python timeout 配置化；
2. 记录 timeout 是否发生；
3. 与 queue 层 4h graph timeout 对齐或合理分层；
4. 验证当前慢/失败是否本来就是 15min timeout 导致。
```

建议新增：

```env
GRAPH_PYTHON_INDEX_TIMEOUT_MS=14400000
```

或至少明确 `indexWithLightRAG()` 不再硬编码 900_000。

---

## 12. LLM Segmentation 成本与效率

LLM segmentation 是正式主路径，但不应读全文。

推荐成本模型：

```text
1000 页文档
  → 100 个 windows
  → 每个 signature 100-150 tokens
  → global planning 输入约 10K-15K tokens
```

局部边界精修：

```text
假设 15 个边界
每个边界读取附近 5K tokens
总计约 75K tokens
```

这通常远低于 Wiki / Graph 对 100+ 小 chunk 逐个抽取的成本，且只发生一次。

重要要求：

```text
WindowSignature 默认本地生成。
不要默认每个 window 都调用 LLM summary。
仅在结构信号不足、低置信度、或需要增强时，对 selected windows 调用 LLM summary。
```

---

## 13. 多语言、多文档类型分段策略

LLM global planning 输入应包含：

```text
window signatures
heading paths
candidate boundaries
token stats
selected previews
```

LLM 输出应包含：

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
      "reason": "This range describes system components, service dependencies, and deployment topology.",
      "confidence": 0.9
    }
  ]
}
```

LLM 输出不是最终真相。
最终边界必须经过局部精修和 deterministic validation。

---

## 14. Deterministic Validation

所有 segments 必须校验：

```text
1. 按 atom index 顺序排列；
2. 不重叠；
3. 不出现主体内容空洞；
4. startAtomIndex/endAtomIndex 合法；
5. pageStart/pageEnd 由 Atom 自动计算；
6. tokenCount 不超过任务上限；
7. 太大 segment 拆 SegmentPart；
8. 太小 segment 合并到相邻语义段；
9. 低 confidence 需要局部精修或 fallback；
10. JSON invalid 需要 repair/retry；
11. 失败时使用已有 Atom/Chunk 兼容路径。
```

---

## 15. 状态与用户体验

不改变前端主交互。

文档基础检索应尽快可用。
Wiki / Graph 是增强阶段。

需要明确产品语义：

```text
基础检索可用 ≠ Wiki/Graph 全部完成
```

如果当前 `document.status = ready` 仍依赖 Graph 完成，需要在实现时重新评估，否则 `document_segment` 插入 Graph 前置后，会延长 `indexing_graph` 状态，损害用户体验。

推荐方向：

```text
document.status = ready 表示基础检索可用
Graph/Wiki/Segment 通过 asyncTask branch 展示增强状态
```

如果暂不改 UI，也至少在任务进度中展示：

```text
正在分析文档主题结构
正在基于主题片段生成 Wiki
正在基于主题片段构建知识图谱
```

---

## 16. Cleanup / Reprocess / Delete

新增 Atom / Segment 后，必须同步处理：

```text
reprocess：取消旧 document_segment / wiki_synthesize / rag_index
reprocess：删除旧 atoms / segments / graph_segments
删除文档：清理 atoms / segments DB rows 和文件
cleanup：清理 graph_segments / segment files / checkpoint v2
旧文档：无 segments 时 fallback chunks
```

新增 `document_segment` 必须纳入 follow-up task cancellation。

---

## 17. Implementation Order（目标架构一致，分 PR 验证）

分 PR 是质量保证措施，不是临时方案。
目标架构始终是：

```text
AtomicSpan/DocumentAtom → LLM-guided DocumentSegment → DocumentChunk
```

推荐顺序：

### PR 1：Wiki 去固定 2000 token 上限

- 动态计算 Wiki input cap；
- 不改 DB；
- 不改 Graph；
- 补测试；
- 验证 Wiki 质量和 JSON invalid rate。

### PR 2：AtomicSpan enrichment / DocumentAtom persistence

- 复用 `buildAtomicSpans`；
- 增加 headingPath / char offsets / page metadata；
- 新增 `DocumentAtom` schema；
- 补 Atom tests。

### PR 3：LLM-guided segmentation 最小闭环

- build window signatures；
- candidate boundaries；
- LLM planning；
- local refinement；
- validation；
- persist `DocumentSegment`；
- 不切 Wiki/Graph 之前先验证 segment coverage / token 分布。

### PR 4：Wiki 使用 DocumentSegment

- Wiki 优先读取 segments；
- fallback chunks 仅用于旧文档/失败恢复；
- checkpoint v2；
- sourceRef 支持 segment/atom/chunk mapping。

### PR 5：Graph 前置风险修正

- Graph Python timeout 配置化；
- 明确 embeddings.bin 对齐策略；
- graph_segments/chunk_*.md 输出；
- cleanup/reprocess 支持。

### PR 6：Graph 使用 Segment / SegmentPart

- Graph worker 传 graph segment dir；
- 禁用 retrieval embeddings.bin 复用；
- SegmentPart 携带领域上下文；
- 验证 entities/relations 质量和耗时。

---

## 18. Metrics

### 18.1 Segmentation metrics

```text
atomCount
windowCount
candidateBoundaryCount
segmentCount
segmentTokenAvg
segmentTokenP50
segmentTokenP90
segmentTokenMax
llmPlanningTokens
boundaryRefinementCalls
segmentationMs
fallbackUsed
```

### 18.2 Wiki metrics

```text
inputUnitType = segment | chunk
inputUnitCount
avgInputTokens
extractionMs
mergeMs
summaryMs
fusionCalls
failedUnits
jsonRepairRetries
jsonRepairFailures
```

### 18.3 Graph metrics

```text
inputUnitType = segment | segment_part | chunk
inputUnitCount
avgInputTokens
graphInsertMs
llmCalls
connectionRetries
timeoutOccurred
failedUnits
entitiesCount
relationsCount
```

---

## 19. 验收标准

### 19.1 质量

```text
Segment 主题一致，边界可解释；
Wiki 条目更完整，不碎片化；
Graph 实体/关系质量不下降；
引用可回溯到 Atom / Chunk；
多语言、多类型文档可自动分段。
```

### 19.2 效率

```text
DocumentChunk 100+ 的大文档，可生成明显更少的 Segment；
Wiki input unit count 显著下降；
Graph input unit count 显著下降；
Wiki/Graph 总耗时下降或质量显著提升且耗时可接受。
```

### 19.3 用户体验

```text
上传 → 开始处理 → 跳转文档库流程不变；
基础检索可用时间不明显变慢；
Graph/Wiki 失败不导致文档整体不可用；
用户不需要选择文档类型或分段边界。
```

---

## 20. 最终结论

最终优化方向是：

> 使用现有 `buildAtomicSpans / AtomicSpan` 作为基础，构建可定位的 `DocumentAtom`；让 LLM 读取压缩后的结构地图和候选边界，主导多语言、多类型文档的领域分段；程序将 LLM 规划精修并校验为 `DocumentSegment`；保留 `DocumentChunk` 作为 embedding / FTS / RAG 检索单元；Wiki 和 Graph 改为基于 `DocumentSegment` 或 `SegmentPart` 处理。

这一路线符合最高原则：

```text
保证质量
提升效率
提升用户体验
简化用户使用的认知和学习负担
```
