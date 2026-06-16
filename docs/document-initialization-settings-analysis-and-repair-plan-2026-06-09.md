# 文档初始化处理设置：实现偏差分析与设计修复方案

日期：2026-06-09

范围：分析文档初始化页面中 `Target Chunk Size`、`Split Strategy`、`Index Target`、`Index Mode` 的现有实现、需求偏差和后续修复设计。本文只提出方案，不包含代码改动。

---

## 1. 结论摘要

当前文档初始化页面暴露了过多“实现细节型”配置，尤其是 `Target Chunk Size`。这些配置最初可能用于调试或早期快速迭代，但经过后续的本地语义切分、双阶段索引、LightRAG 图谱异步化、FTS/Embedding 混合检索等优化后，用户看到的名称与实际行为已经不完全一致。

建议采用以下产品设计方向：

1. **取消 `Target Chunk Size` 用户配置**：不再让用户理解 embedding context window、token 百分比、chunk 上限和拆分阈值之间的关系。系统内部统一采用检索质量优先的默认阈值。
2. **普通用户默认使用高质量自动切分**：`splitStrategy` 默认 `structure-llm`，但实际应更名为“结构优先 + 本地语义切分”，因为现有实现已经不是 LLM 复核。
3. **普通用户默认完整索引**：`indexTarget` 默认 `full`，不再作为常规初始化选项展示。`original`、`chunks` 更适合作为开发/高级模式或内部诊断选项。
4. **保留但重命名 `Index Mode`**：它不是“第一阶段索引模式”，而是“是否启用知识图谱抽取”。建议在 UI 上改为 `Knowledge Graph Extraction` 或“知识图谱抽取”，并说明它会在基础检索可用后异步完成。
5. **统一在服务端归一化处理选项**：即使前端移除配置，服务端也应忽略或限制客户端传入的 `contextUsage`，避免旧客户端或手工请求绕过新的默认策略。

推荐目标体验：用户只需要选择模型和是否启用知识图谱；文档拆分、检索索引范围、chunk 阈值由系统自动选择。

---

## 2. 当前端到后端的实际流程

### 2.1 前端初始化状态

入口页面是 `src/app/(dashboard)/documents/page.tsx`：

- `contextUsage` 默认 `30`，对应 UI 上的 `Target Chunk Size`。
- `splitStrategy` 默认 `structure-llm`。
- `indexTarget` 默认 `full`。
- `indexMode` 默认 `graph`。
- `autoSplit` 默认 `true`。

上传文件时，页面会把这些值全部写入 `FormData`：`contextUsage`、`splitStrategy`、`indexTarget`、`indexMode`、`autoSplit`。点击“开始处理”后，reprocess 请求也会再次传入同一组选项。

### 2.2 API 层只接收，不做语义归一化

`src/app/api/v1/documents/upload/route.ts` 从表单中读取：

```ts
const options: ProcessingOptions = {
  llmModelId,
  embedModelId,
  contextUsage,
  splitStrategy,
  indexTarget,
  indexMode,
  autoSplit,
};
```

`src/app/api/v1/documents/[id]/reprocess/route.ts` 也直接把 `body.options` 作为 `ProcessingOptions` 传入队列。

这意味着当前系统把“前端选择值”当成可信处理策略，没有集中校验或归一化。前端移除配置后，如果服务端不调整，旧请求仍可能继续影响 chunk 阈值和索引行为。

### 2.3 Pipeline 中的真实语义

`src/lib/documents/pipeline.ts` 中，处理选项的实际含义如下：

- `contextUsage`：不是直接的 chunk size，而是 `embedding model contextWindow` 的百分比。
  - `splitRatio = options.contextUsage / 100`，否则使用环境变量 `SPLIT_THRESHOLD`，默认 `0.30`。
  - `chunkMaxTokens = floor(embedContext * splitRatio)`。
  - `splitThreshold = chunkMaxTokens * 2`。
  - `autoSplit !== false && tokenCount > splitThreshold` 时才触发拆分。
- `splitStrategy`：
  - `structure-llm` 走 `sanitizeMarkdown -> splitByMacroAST -> coalesceMacroChunks -> microSplitByLocalSemantic -> injectBreadcrumbs -> enforceEmbeddingSafeChunks`。
  - `heading-only` 走 `splitMarkdown(markdown, { maxTokens, overlapTokens: 100 })`。
- `indexTarget`：
  - `original`：不做 embedding，不做 LightRAG；但仍然会产生 chunk，并同步 FTS。
  - `chunks`：做 chunk embedding 和 FTS；不做 LightRAG。
  - `full`：做 chunk embedding、FTS、LightRAG basic；如果 `indexMode=graph`，再异步启动图谱索引。
- `indexMode`：主 worker 第一阶段始终强制为 `basic`，随后根据原始选项决定是否提交 `rag_index` 图谱任务。

### 2.4 Python LightRAG 层的真实语义

`workers/python/rag_index.py` 支持：

- `basic`：存储 chunks + embedding，不做实体关系抽取。
- `graph`：串行插入 chunk，并用 LLM 抽取实体与关系。

当前图谱模式在 Python 层已经加入了清理同文档旧索引的逻辑，以避免 basic 阶段写入后 graph 阶段被 LightRAG 去重机制跳过。

---

## 3. 单项功能偏差分析

## 3.1 Target Chunk Size

### 当前表现

UI 文案：

- 英文：`Target Chunk Size`
- 中文：`目标 Chunk 大小`
- 描述：`30% = ~2500 tokens，适合大多数文档。更大的 chunk 有利于知识图谱提取。`

前端用一个 `10-100` 的 range slider 暴露百分比。

### 实际作用

它实际控制的是 `contextUsage`，并间接影响：

1. 是否触发拆分：`splitThreshold = chunkMaxTokens * 2`。
2. 每个 chunk 的目标最大 token：`chunkMaxTokens = embedContext * contextUsage%`。
3. 本地语义切分最大段长。
4. heading-only fallback 的最大段长。
5. embedding safety guard 的最大段长。

这不是一个用户能可靠判断的产品参数。用户需要同时理解 embedding 模型上下文窗口、token 估算、chunk 粒度、检索召回、图谱抽取、超大 chunk 对搜索精度的影响，认知成本过高。

### 需求偏差

`Target Chunk Size` 已经从“可配置能力”退化成“暴露内部实现细节”。对普通用户而言，它没有清晰的业务含义，且很容易选错：

- 设置过小：上下文被切得过碎，图谱抽取和段落完整性变差。
- 设置过大：检索粒度变粗，搜索结果命中不够精准，embedding 成本和失败风险上升。
- 设置到 100%：可能接近或超过实际 embedding 模型的可用输入边界，后续 guard 只能被动兜底。

### 修复决策

**取消该功能的用户入口。**

后续代码层建议：

```ts
const DEFAULT_CHUNK_RATIO = 0.30;
const MIN_TARGET_CHUNK_TOKENS = 1200;
const MAX_TARGET_CHUNK_TOKENS = 2500;

function resolveTargetChunkTokens(embedContextWindow?: number): number {
  const context = embedContextWindow || 8192;
  return clamp(Math.floor(context * DEFAULT_CHUNK_RATIO), MIN_TARGET_CHUNK_TOKENS, MAX_TARGET_CHUNK_TOKENS);
}
```

默认策略：

- 以 `30%` 作为内部默认比例，延续当前经过优化后的主路径。
- 增加上下限保护，避免 4K 模型 chunk 过小、32K/100K 模型 chunk 过大。
- 继续保留运维级环境变量覆盖能力，但不暴露给普通用户。
- 服务端忽略普通请求中的 `contextUsage`，或只在显式高级/调试模式下接收。

推荐默认值：**1200-2500 tokens 自动区间，优先落在约 2000-2500 tokens。** 这个区间兼顾：

- 语义检索的精确度；
- 中文长段落完整性；
- LightRAG 实体关系抽取所需上下文；
- embedding 模型输入安全边界；
- 大文档处理性能。

---

## 3.2 Split Strategy

### 当前表现

UI 提供：

- `Structure first + LLM semantic review (Recommended)`
- `Heading and page boundaries only`

中文对应：

- `结构优先 + LLM 语义复核（推荐）`
- `仅按标题和页边界切分`

### 实际作用

现有 `structure-llm` 路径并没有调用 Chat LLM 做语义复核，而是本地结构 + 本地语义算法：

1. `sanitizeMarkdown` 清理 Markdown。
2. `splitByMacroAST` 识别标题、纯文本标题、代码块、表格等宏观结构。
3. `coalesceMacroChunks` 合并过小相邻块。
4. `microSplitByLocalSemantic` 调用 `workers/python/local_chunk.py`，使用本地 ONNX `bge-small-zh-v1.5` 对句子做相似度边界检测。
5. `injectBreadcrumbs` 注入标题路径。
6. `enforceEmbeddingSafeChunks` 保证 embedding 安全。

`heading-only` 是更保守的 fallback，会使用标题、标题候选和行级切分，带固定 overlap。

### 需求偏差

主要偏差是**命名和用户选择权**：

- `structure-llm` 名称已经不符合实现，会误导用户以为导入阶段一定调用 LLM。
- 对普通用户来说，“选择切分算法”依然是技术决策，不是业务决策。
- 当前推荐项本身已经是更好的默认策略，没有必要让用户在普通流程中二选一。

### 修复决策

推荐普通流程中**不展示 Split Strategy**，默认使用高质量自动切分。

内部保留两个策略：

| 内部值 | 建议新名称 | 用途 |
|---|---|---|
| `structure-llm` | `structure-semantic` 或保持值不变但改文案 | 默认高质量路径：结构优先 + 本地语义边界检测 |
| `heading-only` | `fast-structure` | 高级/调试 fallback：标题和行级切分 |

如果短期不改类型值，至少应更新 UI 文案：

- 英文：`Structure + local semantic splitting (Recommended)`
- 中文：`结构优先 + 本地语义切分（推荐）`

---

## 3.3 Index Target

### 当前表现

UI 提供：

- `Original + chunks + LightRAG graph (Recommended)`
- `Original Markdown only`
- `Chunks only`

### 实际作用

它真正控制的是 embedding 和 LightRAG 是否执行，而不是“是否保留原文/分块”。

真实语义：

| 选项 | 实际效果 |
|---|---|
| `original` | 转换 Markdown，仍创建 `documentChunk`，同步 FTS；不做 embedding；不做 LightRAG。|
| `chunks` | 创建 chunks，写 DB embeddings，生成 `embeddings.bin`，同步 FTS；不做 LightRAG。|
| `full` | 创建 chunks，写 embeddings，FTS，LightRAG basic；如果 `indexMode=graph`，再异步图谱。|

### 需求偏差

当前文案把 `indexTarget` 与 `indexMode` 混在一起了：

- `full` 文案写了 `LightRAG graph`，但是否抽取图谱取决于 `indexMode=graph`。
- `original` 文案说“Original Markdown only”，但代码仍会创建 chunk，并同步 FTS。
- `chunks` 对普通用户没有明显业务含义，更多是“不要写入 LightRAG”的内部调试/成本控制选项。

### 修复决策

推荐普通流程中**不展示 Index Target**，默认使用 `full`。

原因：

- `full` 是当前唯一能保证混合检索质量、LightRAG 查询可用、图谱任务可接续的完整路径。
- `original` 和 `chunks` 会降低检索能力，应该属于高级成本控制或开发诊断。
- 用户导入文档的默认期望是“后续能搜、能问、能进入知识图谱”，不是选择底层索引层级。

如果需要保留高级模式，建议改成更直观的三档：

| 新 UI 名称 | 内部值 | 说明 |
|---|---|---|
| `Full retrieval index` / `完整检索索引` | `full` | 默认；FTS + embedding + LightRAG，可选图谱抽取。|
| `Fast local index` / `快速本地索引` | `chunks` | 不写 LightRAG，仅 DB embedding + FTS。|
| `Archive only` / `仅归档` | `original` | 只用于保存和基础关键词，不保证语义检索质量。|

---

## 3.4 Index Mode

### 当前表现

UI 提供：

- `Chunk storage only (fast)`
- `Entity extraction + knowledge graph (Recommended)`

前端默认 `graph`，并根据 embedding 维度是否 >=1536 禁用图谱选项。

### 实际作用

主 worker 中：

```ts
ctx.options.indexMode = getInitialIndexMode(ctx.options); // 永远 basic
const indexResult = await indexDocument(ctx);
ctx.options.indexMode = originalIndexMode;

if (shouldEnqueueGraphIndex(ctx.options)) {
  submit("rag_index", { docId, options });
}
```

也就是说：

1. 第一阶段永远先做 basic，使基础检索尽快可用。
2. 如果用户选择 `graph` 且 `indexTarget=full`，后台再提交图谱任务。
3. 图谱任务在 `document-graph-worker.ts` 中强制设置 `ctx.options.indexMode = "graph"`。
4. `pipeline.indexDocument` 再次检查 embedding 维度，不兼容会降级为 basic。

### 需求偏差

`Index Mode` 这个名字不准确。它不是“整个导入任务的索引模式”，而是“是否在基础索引之后追加知识图谱抽取”。

另外存在一个 UI 状态问题：前端初始化默认 `graph`，但默认 embedding 模型加载时不是通过 `handleEmbedModelChange` 设置的。如果默认模型维度未知或不足，UI 可能出现“当前值为 graph，但 graph 选项 disabled”的状态；后端会兜底降级，但用户感知不清晰。

### 修复决策

建议保留这个决策，但换成更符合真实流程的表达：

- 英文：`Knowledge Graph Extraction`
- 中文：`知识图谱抽取`
- 控件：toggle 或 segmented control。
- 默认：embedding 维度兼容时开启；不兼容或未知时关闭并给出原因。
- 描述：`Basic retrieval becomes available first. Entity/relation extraction runs in the background and may take longer.`
- 中文描述：`基础检索会先可用，实体和关系抽取会在后台继续执行，耗时更长。`

内部仍使用 `indexMode: "basic" | "graph"`，但 UI 不再称它为 `Index Mode`。

---

## 4. 推荐修复方案

## 4.1 推荐方案：普通模式极简化 + 服务端强归一化

这是最推荐的方案。

### 用户可见设置

普通文档初始化页面只保留：

1. `LLM Model`：用于图谱抽取、后续写作/问答等需要 LLM 的任务。
2. `Embedding Model`：用于向量检索与 LightRAG。
3. `Knowledge Graph Extraction`：是否启用后台实体/关系抽取。

移除普通模式中的：

- `Target Chunk Size`
- `Split Strategy`
- `Index Target`
- `Auto Split`（建议一并隐藏并固定为 true；否则用户关闭后会破坏检索质量）

### 服务端默认策略

服务端生成规范化选项：

```ts
type NormalizedProcessingOptions = {
  llmModelId?: string;
  embedModelId?: string;
  splitStrategy: "structure-llm";
  indexTarget: "full";
  indexMode: "basic" | "graph";
  autoSplit: true;
  targetChunkTokens: number;
};
```

其中：

- `targetChunkTokens` 由 embedding model context window 自动计算。
- `contextUsage` 不再来自普通用户请求。
- `indexMode=graph` 需要 embedding dim >=1536，否则降级为 `basic` 并返回/记录提示。
- `splitStrategy` 固定为当前高质量路径。
- `indexTarget` 固定 `full`。

### 优点

- 最大幅度降低用户认知成本。
- 默认质量最稳定。
- 前后端语义一致。
- 旧客户端或手工请求不会轻易破坏 chunk 质量。
- 后续如果要加高级设置，可以有清晰边界。

### 缺点

- 失去一部分调试灵活性。
- 需要为开发/高级场景另设入口或环境变量。

---

## 4.2 备选方案：保留“高级设置”折叠区

如果仍希望给专业用户或开发者保留能力，可以把高级配置放进默认关闭的 `Advanced processing options`。

普通用户默认看不到。展开后显示：

- `Index depth`：完整 / 快速本地 / 仅归档。
- `Split strategy`：高质量自动 / 快速结构。
- 不显示 `Target Chunk Size`；chunk 阈值仍由系统决定。

优点：保留能力，迁移成本较低。

缺点：仍然可能让用户误解配置含义，需要更严格的文案和风险提示。

---

## 4.3 不推荐方案：只删除 Target Chunk Size，其他保持不变

这满足了最小改动，但不解决核心问题：

- `Split Strategy` 文案仍然与实现不一致。
- `Index Target` 仍然混淆索引范围与图谱模式。
- `Index Mode` 仍然无法表达双阶段异步图谱流程。
- `Auto Split` 仍然允许用户关闭影响质量的关键保护。

因此不建议只做表面删减。

---

## 5. 目标交互设计

建议文档初始化设置区改为：

```text
Processing Settings

LLM Model
[ selected chat model ]
Used for knowledge graph extraction and AI reasoning.

Embedding Model
[ selected embedding model ]
Used for semantic retrieval.

Knowledge Graph Extraction
[ On / Off ]
On: basic retrieval is available first; entity/relation extraction continues in the background.
Off: faster import, semantic search still works, but graph view will not be enriched.
```

当 embedding 模型不兼容：

```text
Knowledge Graph Extraction
[ Off disabled ]
This embedding model has 768 dimensions. Knowledge graph mode requires at least 1536 dimensions.
Semantic search will still use chunks and keyword/vector retrieval.
```

可选高级区：

```text
Advanced processing options
[collapsed]

Index depth: Full retrieval index / Fast local index / Archive only
Split strategy: High-quality automatic / Fast structure-only
```

---

## 6. 后续代码修复建议

后续实施时建议按以下顺序修改。

### Phase 1：新增处理选项归一化层

新增一个集中函数，例如：

```ts
normalizeProcessingOptions(rawOptions, models, source): NormalizedProcessingOptions
```

职责：

- 固定或校验 `splitStrategy`。
- 固定普通流程的 `indexTarget=full`。
- 计算 `targetChunkTokens` 或内部 `contextUsage`。
- 根据 embedding dim 计算 effective `indexMode`。
- 对旧客户端传入的 `contextUsage` 做忽略或 clamp。

建议位置：

- `src/lib/documents/processing-options.ts`

### Phase 2：Pipeline 从百分比迁移到目标 token

当前 `resolveProcessingModels` 使用 `contextUsage` 推导 `chunkMaxTokens`。后续应改成：

- 优先使用归一化后的 `targetChunkTokens`。
- 保留环境变量作为运维覆盖。
- `chunkMaxTokens` 必须有 min/max clamp。
- `splitThreshold` 继续为 `chunkMaxTokens * 2`，或改名为 `autoSplitThresholdTokens` 增强语义。

### Phase 3：前端移除/重命名控件

修改：

- `src/components/documents/processing-settings.tsx`
- `src/app/(dashboard)/documents/page.tsx`
- `src/lib/i18n/locales/en.ts`
- `src/lib/i18n/locales/zh-CN.ts`
- `src/lib/i18n/types.ts`

目标：

- 移除 Target Chunk Size slider。
- 普通模式隐藏 Split Strategy、Index Target、Auto Split。
- `Index Mode` 改为 `Knowledge Graph Extraction`。
- 修复 graph 默认值与 embedding 维度不兼容时的 UI 状态。

### Phase 4：API 与测试补齐

需要覆盖：

1. 上传接口不再信任普通请求中的 `contextUsage`。
2. reprocess 接口同样走归一化逻辑。
3. 默认处理选项为 `splitStrategy=structure-llm`、`indexTarget=full`、`autoSplit=true`。
4. 维度不足时 graph 自动降级 basic。
5. UI 不再渲染 Target Chunk Size。
6. `structure-llm` 文案不再声称调用 LLM 语义复核。

---

## 7. 风险与注意事项

### 7.1 与历史任务兼容

队列表中可能已有旧 `options`，仍包含 `contextUsage`、`indexTarget`、`splitStrategy`。归一化函数需要兼容旧数据，不应导致旧任务解析失败。

### 7.2 与高级用户需求兼容

如果未来需要批量导入不同类型文档，可以通过：

- 环境变量；
- 管理员设置；
- 高级折叠区；
- API-only 参数；

保留调试能力，但不应在普通初始化页面暴露。

### 7.3 与搜索质量的关系

删除 `Target Chunk Size` 后，必须确保默认 chunk 策略稳定。建议使用自动区间，而不是单纯固定百分比：

- 低于 1200 tokens：容易过碎。
- 高于 2500 tokens：检索粒度变粗，搜索结果可能不够精确。
- 约 2000-2500 tokens：适合当前结构优先 + 本地语义切分 + LightRAG 图谱抽取的组合。

### 7.4 与 graph 异步状态的关系

`Knowledge Graph Extraction` 开启后，用户应看到“基础检索已可用，图谱仍在后台处理中”的状态，否则会误以为导入已完全结束但图谱为空。

---

## 8. 最终推荐决策表

| 功能 | 当前 UI | 实际实现 | 推荐处理 |
|---|---|---|---|
| Target Chunk Size | 用户 slider 10-100% | 影响 chunkMaxTokens 和 splitThreshold | **移除 UI，服务端自动计算默认阈值** |
| Split Strategy | LLM 语义复核 / heading-only | 默认路径是本地结构 + ONNX 语义边界检测 | 普通模式隐藏；文案改为本地语义切分；保留高级 fallback |
| Index Target | full/original/chunks | 控制 embedding/LightRAG 层级，不等同文案 | 普通模式隐藏，默认 full；高级模式可重命名为 Index depth |
| Index Mode | basic/graph | basic 先跑，graph 后台异步追加 | 保留但改名为 Knowledge Graph Extraction |
| Auto Split | 用户 toggle | 关闭会破坏大文档检索质量 | 建议普通模式隐藏并固定 true |

---

## 9. 建议验收标准

后续代码修复完成后，建议用以下标准验收：

1. 文档初始化页面不再出现 `Target Chunk Size` / `目标 Chunk 大小`。
2. 普通用户不需要理解 chunk token 阈值即可导入文档。
3. 默认导入仍产生高质量 chunks、DB embeddings、FTS、LightRAG basic index。
4. 兼容模型下，知识图谱任务会在基础检索可用后异步启动。
5. 不兼容 embedding 模型下，UI 和服务端都清晰降级到 basic，不出现 disabled 选项与当前值冲突。
6. 搜索页能通过 LightRAG 或 direct embedding fallback 命中文档 chunk。
7. 旧请求携带 `contextUsage` 不会导致异常过大或过小 chunk。
8. i18n 文案与实际实现一致，不再出现“LLM semantic review”这类过时描述。
