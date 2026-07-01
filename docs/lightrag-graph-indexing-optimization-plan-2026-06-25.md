# LightRAG Graph 索引链路优化方案

日期：2026-06-25

范围：优化超大文档在 `indexMode = graph` 时的 LightRAG 索引流程，避免当前 `basic → graph` 双阶段 LightRAG 写入带来的重复成本，同时保留基础检索可用性、图谱异步构建能力和 LLM 服务不稳定时的兜底策略。

---

## 1. 结论摘要

当前系统在用户选择 `graph` 模式时，实际执行的是：

```text
DB embedding / FTS
  → LightRAG basic index
  → enqueue graph task
  → graph task 删除 basic 写入
  → LightRAG graph index + LLM 实体关系抽取
```

这个设计的优点是基础能力较早可用，graph 失败时仍可能保留 LightRAG basic；但缺点也很明显：

1. `graph` 模式总耗时被拉长；
2. 超大文档会额外执行一次 LightRAG basic 写入；
3. graph 阶段为了触发实体关系抽取，还需要删除 basic 阶段已经写入的同文档索引；
4. 用户选择的 `graph` 实际不是直接 graph，而是“basic 后异步 graph”；
5. LLM 不稳定的问题被“所有 graph 文档都预先 basic”这种高成本方式兜底。

推荐最终方案：

> **graph 模式跳过 LightRAG basic 预构建，直接异步构建 LightRAG graph；依靠 DB embedding + FTS 保证基础检索可用；graph 最终失败后记录明确 warning，并按需补建 LightRAG basic fallback，同时允许用户重试 graph。**

优化后的核心流程：

```text
basic 模式：
  DB embedding + FTS + LightRAG basic

graph 模式：
  DB embedding + FTS + LightRAG graph
  不再先执行 LightRAG basic
```

也就是将当前的“双阶段 LightRAG 写入”：

```text
LightRAG basic → LightRAG graph
```

改成更准确的产品语义：

```text
基础检索可用 → 知识图谱异步构建
```

---

## 2. 当前实现分析

### 2.1 当前处理链路

当前文档处理大致分为三个任务：

```text
document_convert
  → convert
  → split
  → persist chunks

rag_embed_index
  → DB embedding
  → FTS sync
  → LightRAG basic index
  → auto tag
  → enqueue rag_index if indexMode = graph

rag_index
  → LightRAG graph index
  → LLM entity/relation extraction
```

关键位置：

- `src/lib/documents/phase1.ts`
  - `document_convert` 完成后提交 `rag_embed_index`。
- `src/lib/queue/workers/rag-embed-index-worker.ts`
  - 当前强制把 `ctx.options.indexMode` 临时改成 `basic`，然后调用 `indexDocument(ctx)`。
- `src/lib/queue/workers/document-graph-worker.ts`
  - graph worker 中强制 `ctx.options.indexMode = "graph"`，再调用 `indexDocument(ctx)`。
- `src/lib/documents/pipeline.ts`
  - `indexDocument()` 根据 `options.indexMode` 调用 Python `rag_index.py`。
- `workers/python/rag_index.py`
  - `basic` 模式只做 chunk storage + embedding；
  - `graph` 模式会额外调用 LLM 抽取实体和关系。

### 2.2 当前 graph 模式的重复成本

当前 `graph` 模式不是直接执行 graph，而是：

```text
1. rag_embed_index 阶段：LightRAG basic 写入 chunks
2. rag_index 阶段：先清理同文档旧索引
3. rag_index 阶段：重新插入 chunks，并执行 graph 抽取
```

Python 侧已有注释说明这一点：

```py
# The rag_embed_index worker runs a basic pass first (chunks stored,
# marked PROCESSED, but NO entities extracted). Graph mode MUST remove
# those chunks so LightRAG re-inserts them WITH entity extraction —
# otherwise ainsert() sees them as "already in storage" and skips,
# yielding zero entities.
```

这意味着 basic 结果不能直接被 graph 复用，反而会成为 graph 前必须清理的状态。

### 2.3 当前设计的合理性

当前设计并非完全没有价值，它主要解决了这些问题：

1. graph 模式依赖 LLM，耗时长、失败率高；
2. basic 索引较快，可让部分检索能力更早可用；
3. graph 拆成独立任务后，不会阻塞所有基础处理；
4. graph 失败时，文档不至于完全不可用；
5. 队列可以分别控制 `rag_embed_index` 和 `rag_index` 并发。

但这个设计的问题是：它用“所有 graph 文档都预先执行 LightRAG basic”的方式给 LLM 不稳定性买保险。对于超大文档，这个保险成本太高。

---

## 3. 目标与非目标

### 3.1 优化目标

1. **减少 graph 模式总耗时**
   - graph 模式不再无条件执行 LightRAG basic。

2. **保留基础检索早可用**
   - 保留 DB chunks；
   - 保留 DB embedding；
   - 保留 FTS；
   - 保留现有 semantic / keyword fallback。

3. **保留图谱异步构建**
   - graph 仍作为独立 `rag_index` 任务执行；
   - graph 不阻塞 DB embedding 和 FTS；
   - graph 任务进度仍可独立展示。

4. **增强 LLM 不稳定场景下的兜底能力**
   - graph 可重试；
   - graph 最终失败后记录清晰 warning；
   - 必要时补建 LightRAG basic fallback；
   - 用户可以修复 LLM 配置后重新触发 graph。

5. **保持 basic 模式行为不变**
   - 用户选择 basic 时仍执行 LightRAG basic。

### 3.2 非目标

1. 不重写整个文档处理 pipeline；
2. 不删除 graph 异步任务机制；
3. 不改变 chunk id、chunk 文件命名或已有 LightRAG Python 参数协议；
4. 不在第一阶段强制引入复杂的新文档状态枚举；
5. 不把 graph 成功作为基础搜索可用的前置条件。

---

## 4. 推荐最终流程

### 4.1 basic 模式流程

`indexTarget = full` 且 `indexMode = basic`：

```text
document_convert
  → convert
  → split
  → persist chunks

rag_embed_index
  → DB embedding
  → FTS sync
  → LightRAG basic index
  → auto tag
  → optional wiki synthesis
  → document ready
```

该流程保持现状。

### 4.2 graph 模式成功流程

`indexTarget = full` 且 `indexMode = graph`：

```text
document_convert
  → convert
  → split
  → persist chunks

rag_embed_index
  → DB embedding
  → FTS sync
  → skip LightRAG basic index
  → auto tag
  → optional wiki synthesis
  → document status = indexing_graph
  → enqueue rag_index

rag_index
  → LightRAG graph index directly
  → LLM entity/relation extraction
  → document status = ready
```

核心变化：

```text
graph 模式下，rag_embed_index 不再调用 LightRAG basic。
```

### 4.3 graph 模式失败流程

```text
rag_index
  → LightRAG graph index
  → LLM/API/timeout/rate-limit failure
  → classify error
  → retry if retryable and attempts remain
  → if final failure:
       document status = ready
       append graph warning
       persist structured task resultData
       optionally enqueue LightRAG basic fallback
```

### 4.4 fallback basic 流程

当 graph 最终失败且需要 LightRAG 层兜底时：

```text
rag_basic_fallback
  → LightRAG basic index
  → success:
       record fallback completed
       document remains ready
  → failure:
       record fallback failed
       document remains ready with warning
```

注意：fallback basic 是失败补偿，不是 graph 模式的默认预处理。

---

## 5. 核心设计决策

### 决策 1：graph 模式仍然先做 DB embedding 和 FTS

不建议跳过 `rag_embed_index` 整个任务。

原因：

1. DB embedding 是当前基础语义检索的重要能力；
2. FTS 是关键词检索的基础能力；
3. graph 模式依赖 LLM，完成时间不可控；
4. graph 失败时，DB embedding + FTS 是最可靠的基础兜底；
5. `embeddings.bin` 可继续作为 LightRAG graph 的 cached embeddings 输入，避免重复 embedding API 调用。

因此，graph 模式跳过的是：

```text
LightRAG basic index
```

不是：

```text
DB embedding / FTS
```

### 决策 2：graph 直接构建，不再预先 basic

当前做法是“预付保险”：

```text
所有 graph 文档都先 basic
```

推荐改为“失败后补偿”：

```text
graph 成功：不做 basic
graph 最终失败：按需补 basic fallback
```

这样可以把额外成本从“所有 graph 文档”转移到“graph 最终失败的文档”。

### 决策 3：Python graph cleanup 逻辑保留

即使新流程不再先 basic，也不应删除 Python graph 前的 cleanup。

原因：

1. 历史数据可能已经有 basic 索引；
2. 用户可能从 basic 重新处理为 graph；
3. reprocess 时可能已有旧 graph；
4. fallback basic 后，用户重试 graph 时仍需删除 basic；
5. 保留 cleanup 是更安全的兼容策略。

新流程下，正常新文档 graph 任务会走到：

```text
No existing chunks to clean
```

从而避免主要删除成本。

### 决策 4：第一阶段不强制新增文档状态枚举

最小可行方案中，graph 失败后可以：

```text
document.status = ready
document.conversionWarning += graph failure warning
rag_index.resultData = structured failure metadata
```

这样不需要马上改 Prisma enum 和大量 UI 判断。

后续可以引入更准确状态：

```text
search_ready_graph_indexing
ready_graph_failed
ready_basic_fallback
```

但不建议作为第一阶段必要条件。

---

## 6. LLM 不稳定处理策略

### 6.1 失败分类

#### 可重试失败

包括：

```text
429 rate limit
5xx upstream error
timeout
ECONNRESET
ETIMEDOUT
network error
provider overloaded
```

处理：

```text
自动重试 graph
使用指数退避
达到最大次数后进入 final failure
```

建议默认：

```text
maxGraphRetries = 2 或 3
backoff = 2min, 5min, 15min
```

#### 配置类失败

包括：

```text
401 unauthorized
403 forbidden
model not found
invalid api_base
missing API key
LLM model unavailable
embedding dim incompatible
```

处理：

```text
不做无意义重试
直接标记 graph_failed
提示用户修复配置
按需触发 basic fallback
```

#### 数据类失败

包括：

```text
chunk files missing
embeddings.bin corrupted
embedding dimension mismatch
document deleted
superseded task
```

处理：

- 文档已删除：cancel，不 fallback；
- 任务被新任务 supersede：cancel，不 fallback；
- embeddings 损坏：尝试回退 embedding API 或要求重新处理；
- dimension mismatch：沿用现有 reset/retry 策略，给出明确提示。

### 6.2 graph 最终失败后的行为

graph 最终失败时，不应把整个文档标成完全失败。

推荐：

```text
document.status = ready
conversionWarning += "Knowledge graph extraction failed. Basic search remains available."
rag_index.status = failed 或 completed_with_warning
rag_index.resultData = {
  indexMode: "graph",
  graphStatus: "failed",
  errorType: "rate_limit" | "timeout" | "auth" | "config" | "data" | "unknown",
  fallback: "none" | "basic_enqueued" | "basic_completed" | "basic_failed",
  retryable: boolean,
  attempts: number
}
```

### 6.3 basic fallback 触发策略

不建议第一次 graph 失败就立即补建 basic。

推荐策略：

```text
if retryable failure and attempts remain:
  retry graph
else:
  mark graph final failure
  enqueue LightRAG basic fallback if configured
```

可通过配置控制：

```text
LIGHTRAG_GRAPH_MAX_RETRIES=2
LIGHTRAG_GRAPH_RETRY_BACKOFF_MS=120000,300000,900000
LIGHTRAG_GRAPH_BASIC_FALLBACK=true
```

### 6.4 用户重试 graph

用户修复 LLM 配置后，应允许重新触发 graph。

如果此时 fallback basic 已经写入 LightRAG，现有 Python graph cleanup 会先删除 basic，再重新 graph，这与当前机制兼容。

---

## 7. 代码改造建议

### 7.1 修改 `rag-embed-index-worker`

目标：graph 模式下只做 DB embedding / FTS / auto tag / enqueue graph，不做 LightRAG basic。

当前逻辑类似：

```ts
const originalIndexMode = ctx.options.indexMode;
ctx.options.indexMode = "basic";
const indexResult = await indexDocument(ctx);
ctx.options.indexMode = originalIndexMode;
```

推荐改成：

```ts
const originalIndexMode = ctx.options.indexMode;
const willGraph = shouldEnqueueGraphIndex(ctx.options);

let indexResult: Awaited<ReturnType<typeof indexDocument>> | null = null;

if (!willGraph) {
  ctx.options.indexMode = "basic";
  indexResult = await indexDocument(ctx);
  ctx.options.indexMode = originalIndexMode;
}
```

更显式的版本：

```ts
const shouldRunLightRagBasic =
  (ctx.options.indexTarget || "full") === "full" &&
  ctx.options.indexMode !== "graph";

let indexResult: Awaited<ReturnType<typeof indexDocument>> | null = null;

if (shouldRunLightRagBasic) {
  const originalIndexMode = ctx.options.indexMode;
  ctx.options.indexMode = "basic";
  indexResult = await indexDocument(ctx);
  ctx.options.indexMode = originalIndexMode;
}
```

注意：

- `original` 和 `chunks` 本来就不应执行 LightRAG；
- `full + basic` 继续执行 LightRAG basic；
- `full + graph` 跳过 LightRAG basic，后续提交 `rag_index`。

### 7.2 保留 graph enqueue 逻辑

当前逻辑可保留：

```ts
if (shouldEnqueueGraphIndex(ctx.options)) {
  await getQueue().submit("rag_index", { docId: ctx.docId, options: ctx.options }, ctx.doc.userId);
}
```

### 7.3 保留 graph worker 主逻辑

`document-graph-worker.ts` 中仍应：

```ts
ctx.options.indexMode = "graph";
const indexResult = await indexDocument(ctx, onProgress);
```

优化重点不在 graph worker，而是在 graph 之前不再 basic。

### 7.4 `indexDocument()` 第一阶段尽量不改

第一阶段建议不大改 `indexDocument()`。

它继续负责：

- FTS sync；
- 判断 `indexTarget`；
- 解析 embedding dim；
- 调用 `indexWithLightRAG()`；
- 传递 cached embeddings；
- 记录 graph token usage。

是否调用它，由 worker 决定。

### 7.5 Python `rag_index.py` 保持 cleanup

保留：

```py
if index_mode == "graph":
    clean existing RAG chunks for document
```

这是兼容历史索引和 fallback 后重试 graph 的必要逻辑。

### 7.6 增加 graph retry / fallback 机制

可以分两步实现。

#### 阶段一：最小可行

- graph 失败后记录 structured resultData；
- document 标为 `ready`；
- conversionWarning 写入 graph 失败提示；
- UI 允许用户重试 graph。

#### 阶段二：自动 fallback

- 增加 graph 失败分类；
- 增加 graph 重试次数；
- final failure 后提交 basic fallback task；
- fallback 结果写回 task resultData / warning。

---

## 8. UI 与产品文案调整

当前 `Index Mode` 容易让用户误解为 LightRAG 原生索引模式选择。

建议改名为：

```text
Knowledge Graph Extraction
```

中文：

```text
知识图谱抽取
```

描述建议：

```text
开启后，系统会先完成基础检索索引，然后异步构建知识图谱。超大文档的图谱抽取可能耗时较长，并依赖所选 LLM 服务稳定性。
```

优化后，“基础检索索引”应指：

```text
DB embedding + FTS
```

而不是 LightRAG basic。

graph 失败时提示建议：

```text
知识图谱抽取失败，但基础搜索仍可用。你可以稍后重试，或检查 LLM 模型/API 配置。
```

如果 basic fallback 成功：

```text
知识图谱抽取失败，系统已回退到基础 LightRAG 索引。基础搜索可用，你可以稍后重试知识图谱抽取。
```

---

## 9. 行为对照表

| indexTarget | indexMode | 当前行为 | 优化后行为 |
|---|---|---|---|
| original | basic | 转换/切分，不 embedding，不 LightRAG | 不变 |
| original | graph | 不应触发 graph | 不变 |
| chunks | basic | DB embedding + FTS，不 LightRAG | 不变 |
| chunks | graph | 不应触发 graph | 不变 |
| full | basic | DB embedding + FTS + LightRAG basic | 不变 |
| full | graph | DB embedding + FTS + LightRAG basic + LightRAG graph | DB embedding + FTS + LightRAG graph，失败后按需 basic fallback |

---

## 10. 风险与应对

### 风险 1：graph 完成前 LightRAG 查询没有该文档

优化后，graph 模式跳过 LightRAG basic，因此 graph 完成前 LightRAG storage 中可能没有该文档。

应对：

- 确认搜索链路在 LightRAG 不可用或缺结果时能 fallback 到 DB semantic / FTS；
- graph 处理中，UI 明确展示“基础检索可用，知识图谱构建中”；
- 如某些功能强依赖 LightRAG storage，需要单独审查。

### 风险 2：graph 最终失败后没有 LightRAG basic

应对：

- document 不标完全 failed；
- DB embedding + FTS 保证基础搜索；
- 记录 warning；
- 可配置自动 basic fallback。

### 风险 3：wiki synthesis 是否依赖 LightRAG basic

当前注释显示 wiki synthesis 只依赖 chunks。

应对：

- 验证 wiki synthesis 不读取 LightRAG basic；
- 若只依赖 DB chunks，则无影响。

### 风险 4：历史数据与 reprocess

历史文档可能已有 basic 或 graph 索引。

应对：

- 保留 Python graph cleanup；
- graph 重试时允许清理并重建；
- basic fallback 后再 graph 也由 cleanup 覆盖。

### 风险 5：任务状态表达不够精确

第一阶段如果仍用 `indexing_graph` / `ready`，可能无法精确表达“基础搜索已可用，图谱失败”。

应对：

- 短期使用 `conversionWarning` + task resultData；
- 后续考虑新增更精确状态。

---

## 11. 测试方案

### 11.1 worker 单元测试

#### case 1：`full + basic`

期望：

- 调用 `embedDocumentChunks()`；
- 调用 `indexDocument()`；
- `indexDocument()` 时 indexMode 为 `basic`；
- 不提交 `rag_index`；
- 文档最终 `ready`。

#### case 2：`full + graph`

期望：

- 调用 `embedDocumentChunks()`；
- 不调用 LightRAG basic 对应的 `indexDocument()`；
- 提交 `rag_index`；
- 文档状态为 `indexing_graph`。

#### case 3：`chunks + graph`

期望：

- 做 DB embedding；
- 不调用 `indexDocument()`；
- 不提交 `rag_index`；
- 文档最终 `ready`。

#### case 4：`original + graph`

期望：

- 不做 DB embedding；
- 不调用 `indexDocument()`；
- 不提交 `rag_index`。

### 11.2 graph worker 测试

期望：

- `ctx.options.indexMode = "graph"`；
- 调用 `indexDocument()`；
- 成功后文档状态为 `ready`；
- resultData 包含 graph index result；
- 失败时 resultData 包含 structured failure metadata。

### 11.3 Python 层测试

期望：

- graph 模式下 cleanup 仍执行；
- 没有既有 doc_status 时 cleanup 不报错；
- 有旧 basic 状态时 cleanup 后可以 graph insert；
- cached embeddings 文件存在时不调用 embedding API；
- graph 插入可以正常抽取实体关系。

### 11.4 集成验证

分别用小文档和超大文档验证：

#### basic 模式

```text
上传 → 处理 → ready → 搜索可用 → LightRAG basic 可用
```

#### graph 模式成功

```text
上传 → DB embedding / FTS 完成 → indexing_graph → rag_index running → ready → knowledge graph 有节点
```

确认 graph 模式下不再出现 LightRAG basic 预构建。

#### graph 模式失败

模拟：

- LLM 429；
- LLM timeout；
- API key 错误；
- model not found。

期望：

- 可重试错误会重试；
- final failure 后文档基础搜索仍可用；
- warning 明确；
- 可选 basic fallback 被触发；
- 用户可重试 graph。

---

## 12. 分阶段实施计划

### 阶段一：跳过 graph 模式的 LightRAG basic

改动：

1. 修改 `rag-embed-index-worker.ts`；
2. `full + graph` 下跳过 `indexDocument(ctx)` basic 调用；
3. 保留 DB embedding、FTS、auto tag、wiki synthesis、graph enqueue；
4. 补 worker 测试；
5. 手动验证 graph 能直接构建。

收益：

- 立即减少 graph 模式重复 LightRAG 写入；
- 超大文档总耗时下降；
- 改动范围较小。

### 阶段二：graph 失败 structured result + warning

改动：

1. graph worker 捕获失败并分类；
2. 写入 task resultData；
3. 文档改为 `ready`，但追加 graph warning；
4. UI 展示“基础搜索可用，知识图谱失败”；
5. 提供重试入口。

收益：

- LLM 不稳定时用户能理解发生了什么；
- 文档不会因为 graph 失败表现为完全不可用。

### 阶段三：自动 retry 与 basic fallback

改动：

1. 增加 graph retry 配置；
2. retryable 错误自动退避重试；
3. final failure 后提交 basic fallback；
4. fallback 成功/失败写回 resultData；
5. UI 展示 fallback 状态。

收益：

- 用按需 fallback 替代无条件预构建 basic；
- 保持可靠性，同时减少成功路径成本。

### 阶段四：状态与文案精细化

可选改动：

1. UI 将 `Index Mode` 改为 `Knowledge Graph Extraction` / `知识图谱抽取`；
2. 考虑新增状态：
   - `search_ready_graph_indexing`
   - `ready_graph_failed`
   - `ready_basic_fallback`
3. 搜索/文档详情页展示更准确 pipeline。

---

## 13. 最终推荐结论

最终推荐方案不是简单删除 basic，也不是继续保留当前 `basic → graph`。

推荐方案是：

```text
basic 模式：
  DB embedding + FTS + LightRAG basic

graph 模式：
  DB embedding + FTS + LightRAG graph
  graph 成功时不做 LightRAG basic
  graph 最终失败时按需补建 LightRAG basic fallback
```

设计原则：

```text
不要为了 LLM 可能失败，让所有 graph 文档都预先执行 LightRAG basic。
应该让 graph 直接执行；只有 graph 最终失败时，再按需补偿。
```

这能同时满足：

1. 超大文档 graph 总耗时更短；
2. 基础搜索仍然早可用；
3. graph 仍然异步、可重试；
4. LLM 不稳定时有 warning 和 fallback；
5. basic 模式行为保持不变；
6. 历史数据和 reprocess 通过 Python cleanup 兼容。
