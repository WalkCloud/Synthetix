# Synthetix 代码优化指导方案

> 日期：2026-05-18  
> 目标：指导后续代码优化工作，在提升可维护性、可读性、复用性和执行效率的同时，不破坏当前已经开发完成的功能。

## 1. 项目定位

Synthetix 是一个本地优先、自托管的 AI 长文写作工作台。它的核心价值不是单纯生成文本，而是帮助用户把参考资料转化为可追踪来源的结构化长文档。

核心流程：

```text
上传参考资料
→ 转换为 Markdown
→ 文档切分与索引
→ 建立 RAG / Knowledge Graph
→ 头脑风暴
→ 生成递归大纲
→ 按章节写作
→ 保留引用来源
→ 支持模型对比、润色、审计、图表/图片资产
→ 导出长文档
```

优化工作必须服务于这个核心流程，不能为了重构而重构。

## 2. 当前主要功能边界

### 2.1 认证与用户层

相关位置：

- `src/lib/auth/*`
- `src/proxy.ts`
- `src/app/api/v1/auth/**`

职责：

- 用户 setup / login / logout / refresh
- JWT access / refresh token 校验
- dashboard 和 API 路由保护

### 2.2 数据层

相关位置：

- `prisma/schema.prisma`
- `src/lib/db.ts`

核心实体：

- `User`
- `ModelProvider`
- `ModelConfig`
- `AsyncTask`
- `TokenUsage`
- `Document`
- `DocumentChunk`
- `Tag`
- `DocumentTag`
- `BrainstormSession`
- `Message`
- `Draft`
- `Section`
- `SectionVersion`
- `SectionReference`
- `SectionAsset`

### 2.3 文档处理层

相关位置：

- `src/lib/queue/workers/document-worker.ts`
- `src/lib/documents/converter.ts`
- `src/lib/documents/splitter.ts`
- `src/lib/documents/semantic-splitter.ts`
- `src/lib/documents/storage.ts`

职责：

- 文档转换
- token 估算
- 文档切分
- semantic merge
- chunk 持久化
- embedding
- FTS 同步
- LightRAG indexing

### 2.4 搜索与 RAG 层

相关位置：

- `src/lib/search/fts.ts`
- `src/lib/search/semantic.ts`
- `src/lib/rag/client.ts`
- `src/lib/rag/dimension.ts`
- `workers/python/rag_index.py`
- `workers/python/rag_query.py`
- `workers/python/rag_manage.py`

职责：

- SQLite FTS5 keyword search
- semantic search
- LightRAG 查询
- Knowledge Graph entity / relation 管理
- Node 与 Python worker 边界封装

### 2.5 LLM 模型接入层

相关位置：

- `src/lib/llm/adapter.ts`
- `src/lib/llm/factory.ts`
- `src/lib/llm/resolve-model.ts`
- `src/lib/llm/usage.ts`
- `src/lib/llm/capabilities.ts`

职责：

- OpenAI-compatible provider 适配
- chat / stream / embedding 调用
- provider 测试
- capability 解析
- token usage 记录
- 默认模型解析

### 2.6 写作生成层

相关位置：

- `src/lib/writing/generator.ts`
- `src/lib/writing/context.ts`
- `src/lib/writing/auditor.ts`
- `src/lib/writing/humanizer.ts`
- `src/lib/writing/diagram-*`
- `src/app/api/v1/drafts/**`

职责：

- section generation
- SSE streaming
- RAG reference retrieval
- A/B model comparison
- version / rollback
- humanize
- audit
- diagram / image / Mermaid / SVG assets
- export

### 2.7 前端交互层

相关位置：

- `src/app/(dashboard)/documents/page.tsx`
- `src/app/(dashboard)/library/page.tsx`
- `src/app/(dashboard)/writing/[id]/page.tsx`
- `src/app/(dashboard)/topology/page.tsx`
- `src/app/(dashboard)/settings/page.tsx`
- `src/components/**`

职责：

- 文档上传与处理配置
- Library 查询与管理
- 写作编辑器
- 拓扑图 / Knowledge Graph 可视化
- 模型管理
- 设置管理

## 3. 优化必须遵守的不变量

### 3.1 API response shape 不可随意改变

当前 API 统一返回结构为：

```ts
{ success, data?, error? }
```

前端页面直接依赖该结构。优化 API helper 时只能统一实现方式，不能破坏 response shape。

### 3.2 文档处理状态不可改变语义

`Document.status` 是 UI 可见状态：

```text
uploading
converting
splitting
embedding
indexing
ready
failed
```

`AsyncTask.status` 和 `AsyncTask.progress` 也被前端轮询展示。优化文档处理流程时不能随意改变状态含义和关键进度点。

### 3.3 chunk index 和文件命名必须稳定

文档 chunk 依赖：

```text
DocumentChunk.index
chunk_000.md
chunk_001.md
...
```

Python LightRAG 侧 chunk id 依赖：

```text
<docId>/chunk_XXX
```

优化 split / persist 流程时必须保持 index 连续、文件命名稳定、DB 与文件系统对应关系一致。

### 3.4 FTS rowid 对齐不可破坏

SQLite FTS5 索引依赖 `document_chunks.rowid`。优化 `src/lib/search/fts.ts` 时不能破坏 rowid 对齐关系。

### 3.5 LightRAG fallback 不可移除

semantic search 当前行为：

```text
优先 LightRAG
→ 失败后 fallback 到 direct embedding cosine search
```

这是重要容错能力。优化时可以增强，但不能移除 fallback。

### 3.6 SSE 协议必须兼容

section generation endpoint 使用 SSE：

```text
data: {"type":"references", ...}

data: {"type":"reasoning", ...}

data: {"type":"chunk", ...}

data: {"type":"assets", ...}

data: {"type":"done"}

data: {"type":"error", ...}
```

前端 parser 依赖该协议。优化生成流程时必须保持兼容。

### 3.7 引用追踪不可丢失

`SectionReference` 是核心产品价值。优化写作生成、对比、导出、拓扑展示时不能丢失：

- `sectionId`
- `documentId`
- `chunkId`
- `documentName`
- `relevanceScore`
- `sourceAnchor`

### 3.8 内容资产 marker 不可改变

当前内容中的资产 marker：

```text
[DIAGRAM:<assetId>]
[IMAGE:<assetId>]
```

`ContentRenderer`、导出逻辑和 asset API 都依赖该格式。优化 diagram / image 流程时必须保持兼容。

### 3.9 API key 解密边界必须收紧

API key 存储在数据库中是加密的。优化 provider / RAG helper 时必须保证：

- 不向前端返回解密后的 key
- 不在日志中打印 key
- 只在实际调用 provider 或 Python worker 前解密
- 不扩大解密数据的生命周期

### 3.10 SQLite 并发必须保守

项目默认使用 SQLite。本地优先场景下不能激进并发写 DB，避免 lock contention。

## 4. 推荐总体策略

采用分阶段综合优化：

```text
Phase 1: 低风险复用和一致性整理
Phase 2: LLM / Provider / RAG 边界统一
Phase 3: 前端大组件拆分和渲染优化
Phase 4: 文档处理 pipeline 拆分
Phase 5: 性能和并发优化
Phase 6: 测试保护和回归验证体系
```

原则：

1. 先减少重复代码。
2. 再统一边界和类型。
3. 再拆复杂流程。
4. 最后处理性能和并发。
5. 每一阶段都必须有测试或手动验证保护。

## 5. Phase 1：低风险复用和一致性整理

目标：不改变业务流程，只减少重复、提升可读性、降低逻辑漂移。

### 5.1 统一 API helper 使用

已有 helper：

- `src/lib/api-helpers.ts`

包括：

```ts
getErrorMessage()
authOrError()
authErrorResponse()
errorResponse()
successResponse()
```

后续优化建议：

- API route 中逐步替换手写 `Unauthorized` response。
- 逐步替换重复的 `error instanceof Error ? error.message : "Unknown error"`。
- 保持原有 HTTP status 和 response shape。
- 不一次性改所有 route，按业务模块逐步推进。

风险：低。

### 5.2 统一 capability parsing

已有共享模块：

- `src/lib/llm/capabilities.ts`

后续优化建议：

- 所有 capability parsing 统一使用共享函数。
- UI 组件只负责展示，不再实现 JSON 兼容解析。
- provider form、model tabs、API route 应使用同一套解析规则。

风险：低。

### 5.3 提取通用文本和格式化工具

建议新增：

```text
src/lib/text/count-words.ts
src/lib/format/file-size.ts
```

适合抽取的重复逻辑：

- `countWords()`
- file size formatting
- file type display
- status label mapping

注意：只抽取语义稳定、重复明显的工具，不做过度抽象。

风险：低。

### 5.4 提取通用 UI primitives

建议逐步新增：

```text
src/components/shared/status-badge.tsx
src/components/shared/empty-state.tsx
src/components/shared/confirm-action-button.tsx
src/components/shared/loading-state.tsx
```

适用场景：

- Library document status
- Upload status
- Task status
- Section status
- Model test status

风险：低。

### 5.5 稳定 ContentRenderer 的 asset version

重点检查：

- `src/components/writing/content-renderer.tsx`

如果 render path 中使用 `Date.now()` 作为默认 version，会导致 asset URL 每次 render 变化，造成缓存失效和无意义 reload。

建议：

- `renderVer` 由调用方显式传入。
- 默认值保持稳定。
- 只有 asset 变化时更新 version。

风险：低。

## 6. Phase 2：LLM / Provider / RAG 边界统一

目标：统一最容易发生逻辑漂移的 provider、embedding、RAG 配置逻辑。

### 6.1 统一 provider endpoint 构造

当前多个位置存在类似逻辑：

```ts
.replace(/\/embeddings(\/\w+)?$/, "")
.replace(/\/chat\/completions$/, "")
.replace(/\/v\d+$/, "")
```

建议新增：

```text
src/lib/llm/provider-endpoints.ts
```

建议提供：

```ts
normalizeProviderBaseUrl()
buildChatCompletionsUrl()
buildEmbeddingsUrl()
buildModelsUrl()
buildProviderHeaders()
```

必须兼容：

- OpenAI
- Ollama
- DeepSeek
- OpenAI-compatible providers
- 用户填写 `/v1`
- 用户填写 `/v1/chat/completions`
- 用户填写 `/v1/embeddings`
- provider test fallback 行为

风险：中等。

### 6.2 统一 embedding dimension resolution

建议新增：

```text
src/lib/llm/embedding-dimension.ts
```

职责：

```ts
resolveEmbeddingDimension(modelConfig)
detectEmbeddingDimension(provider, modelId)
validateEmbeddingDimension(modelConfig, expectedDim)
getKnownEmbeddingDimension(modelId)
```

优先级：

```text
DB 中的 ModelConfig.embeddingDim
→ 已知模型 fallback
→ provider probing
→ 安全默认值或显式失败
```

Python worker 原则：

- 优先消费 Node 传入的 `--embed-dim`。
- 尽量减少 Python 侧 fallback 表。
- 避免 TS 与 Python 两套维度逻辑漂移。

风险：中等。

### 6.3 引入 RAG context helper

建议新增：

```text
src/lib/rag/context.ts
```

提供：

```ts
createRagContext(userId)
```

返回：

```ts
{
  embedModel,
  llmModel,
  embedConfig,
  llmConfig,
  embedDim
}
```

适用位置：

- `src/app/api/v1/knowledge/entities/route.ts`
- `src/app/api/v1/knowledge/entities/[name]/route.ts`
- `src/app/api/v1/knowledge/graph/route.ts`
- `src/app/api/v1/knowledge/manage/route.ts`
- semantic search / LightRAG query path

风险：低到中等。

### 6.4 收紧 `manageRag()` 类型

当前 `RagManageOptions` 使用宽泛结构：

```ts
action: string
keyword?: string
entityName?: string
...
```

建议改为 discriminated union：

```ts
type RagManageOptions =
  | { action: "entities"; keyword?: string; limit?: number; ... }
  | { action: "entity-detail"; entityName: string; ... }
  | { action: "graph"; depth?: number; maxNodes?: number; ... }
  | { action: "delete-by-doc"; docId: string; ... }
  | { action: "create-entity"; entityName: string; entityType?: string; ... }
  | { action: "edit-entity"; entityName: string; field: string; value: string; ... }
  | { action: "merge-entities"; sources: string; target: string; ... }
  | { action: "delete-entity"; entityName: string; ... }
```

收益：

- 编译期防止 action 参数传错。
- route handler 更清晰。
- Python worker 边界更明确。

风险：中等。

## 7. Phase 3：前端大组件拆分和渲染优化

目标：降低页面维护成本，消除明显 render 热点。

### 7.1 拆分 documents page

当前位置：

- `src/app/(dashboard)/documents/page.tsx`

建议拆成：

```text
DocumentUploadPanel
ProcessingOptionsPanel
ModelSelectionPanel
UploadQueuePanel
```

原则：

- 先抽展示组件。
- 后抽 hooks。
- 不改变现有 fetch URL 和上传流程。

风险：中等。

### 7.2 拆分 library page

当前位置：

- `src/app/(dashboard)/library/page.tsx`

建议拆成：

```text
LibraryStats
LibraryFilters
LibrarySearchPanel
DocumentTable
ProcessingStatusPoller
```

需要保留：

- keyword / semantic 切换
- semantic search loading 文案
- processing status polling
- delete confirmation
- reindex action
- pagination / filtering / sorting

风险：中等。

### 7.3 拆分 settings page

当前位置：

- `src/app/(dashboard)/settings/page.tsx`

建议按 tab 拆分：

```text
ProfileSettingsTab
StorageSettingsTab
DatabaseSettingsTab
RagSettingsTab
MigrationSettingsTab
```

风险：中等。

### 7.4 拆分 writing editor orchestration

当前位置：

- `src/app/(dashboard)/writing/[id]/page.tsx`

建议逐步抽出：

```text
useDraftEditor()
useSectionGeneration()
useSectionComparison()
useSectionExport()
useRagConfig()
```

必须保留：

- first pending section auto-selection
- SSE references / reasoning / chunk / error handling
- compare vs single generation
- confirm 后跳转到下一个 pending / failed section
- manual edit
- humanize
- regenerate
- unlock
- export
- asset preview / insert / generate

风险：中等偏高。

### 7.5 优化 topology canvas 热路径

当前位置：

- `src/components/topology/topology-canvas.tsx`

第一步低风险优化：

```ts
useMemo(() => itemById)
useMemo(() => edgeByTarget)
useMemo(() => edgesByTarget)
```

第二步中风险优化：

- transform 使用 ref 或 CSS variable。
- 无交互时暂停 animation。
- 避免 `requestAnimationFrame` 每帧触发 React 全组件 re-render。

风险：第一步低，第二步中等。

### 7.6 统一 fetch / mutation / polling hooks

建议新增：

```text
src/hooks/use-fetch-json.ts
src/hooks/use-mutation-refetch.ts
src/hooks/use-polling.ts
src/hooks/use-models-by-capability.ts
```

原则：

- 不引入 React Query / SWR，除非后续明确需要。
- 先统一项目内部重复模式。
- 保持现有 API 调用方式和返回结构。

风险：低到中等。

## 8. Phase 4：文档处理 pipeline 拆分

目标：把 `processDocument()` 从大流程函数拆成可测试阶段。

当前位置：

- `src/lib/queue/workers/document-worker.ts`

建议拆分为：

```ts
loadProcessingTask()
convertDocumentToMarkdown()
resolveProcessingModels()
calculateSplitPlan()
splitDocumentContent()
persistDocumentChunks()
embedDocumentChunks()
syncDocumentSearchIndex()
indexDocumentWithRag()
markDocumentReady()
markDocumentFailed()
```

目标结构：

```ts
export async function processDocument(taskId: string) {
  const ctx = await loadProcessingTask(taskId)

  try {
    await markConverting(ctx)
    const markdown = await convertDocumentToMarkdown(ctx)

    const plan = await calculateSplitPlan(ctx, markdown)
    const chunks = await splitDocumentContent(ctx, markdown, plan)

    await persistDocumentChunks(ctx, chunks)
    await embedDocumentChunks(ctx)
    await syncDocumentSearchIndex(ctx)
    await indexDocumentWithRag(ctx)

    await markDocumentReady(ctx)
  } catch (error) {
    await markDocumentFailed(ctx, error)
  }
}
```

必须保持：

- status 更新顺序
- progress 关键点
- `indexTarget` 语义
- `splitStrategy` 语义
- LightRAG failure non-blocking
- FTS failure non-blocking
- token usage best-effort
- chunk index / file naming

风险：中等偏高。

建议在 Phase 1-3 完成后再进行。

## 9. Phase 5：性能和并发优化

目标：只对明确热点做保守优化。

### 9.1 embedding DB 写入 bounded concurrency

当前 embedding API 调用已有一定并发，但 DB update 仍可能逐条 await。

建议：

- 使用 3-5 的小并发写 DB。
- 或按 batch transaction。
- 不使用无限并发。

风险：中等。SQLite 写锁需要谨慎。

### 9.2 chunk 文件保存 bounded concurrency

如果存在：

```ts
await Promise.all(chunks.map(saveChunk))
```

大文档会触发大量并发文件写入。

建议：

- 限制为 8-16 并发。
- 或按 batch 保存。

风险：低到中等。

### 9.3 semantic split LLM batch 保守并发

当前 semantic split 适合做 title-only 小并发。

建议：

- 2-3 并发。
- merge application 保持原顺序。
- 遇到 rate limit 或 timeout 时 fallback 到结构切分。

风险：中等。

### 9.4 LightRAG embedding cache

当前 worker 会计算 DB embedding，LightRAG indexing 可能再次调用 embedding API。

建议：

- 在 embedding 阶段生成 Python 可消费的 embedding cache。
- Python worker 优先读取 cache。
- 明确 TS/Python cache 文件协议。

风险：中等偏高。

收益：大文档处理成本明显下降。

### 9.5 search payload 分层

当前 direct semantic fallback 可能返回较长 content preview。

建议区分：

```ts
snippetMode: "preview" | "context"
```

或返回：

```ts
previewSnippet
fullContent
```

UI 列表使用短 preview，写作/RAG context 使用长内容。

风险：中等。

## 10. Phase 6：测试保护和回归验证

### 10.1 现有测试保护区域

当前已有相关测试：

```text
src/__tests__/api-helpers.test.ts
src/__tests__/auth/jwt.test.ts
src/__tests__/documents/converter.test.ts
src/__tests__/documents/embedder.test.ts
src/__tests__/documents/splitter.test.ts
src/__tests__/llm/adapter.test.ts
src/__tests__/llm/capabilities.test.ts
src/__tests__/queue/queue.test.ts
src/__tests__/search/fts.test.ts
src/__tests__/writing/audit.test.ts
```

### 10.2 建议新增测试

建议后续新增：

```text
src/__tests__/llm/provider-endpoints.test.ts
src/__tests__/llm/embedding-dimension.test.ts
src/__tests__/rag/context.test.ts
src/__tests__/rag/manage-options.test.ts
src/__tests__/documents/document-worker-pipeline.test.ts
src/__tests__/search/semantic.test.ts
src/__tests__/writing/sse-generate-route.test.ts
src/__tests__/writing/content-renderer-assets.test.tsx
```

### 10.3 每阶段最低验证命令

每阶段优化后至少运行：

```bash
pnpm test:run
pnpm lint
pnpm build
```

涉及 UI 时，还需要：

```bash
pnpm dev
```

并手动验证核心流程。

### 10.4 手动回归清单

至少验证：

- setup / login
- 添加模型 provider
- provider test connection
- 上传文档
- 文档处理到 ready
- keyword search
- semantic search
- Knowledge Graph 查询
- brainstorm 创建 session
- 生成 outline
- 创建 draft
- section SSE 生成
- references 展示
- compare A/B
- confirm section
- rollback
- humanize
- diagram / image marker 渲染
- export

## 11. 推荐落地顺序

### 第一批：低风险快速收益

1. 统一 `parseCapabilities`。
2. 提取 `countWords`。
3. 提取 file size formatter。
4. 稳定 `ContentRenderer` 的 render version。
5. 小范围统一 API helper。
6. topology 中预计算 map，减少 `find` / `filter`。

### 第二批：模型和 RAG 统一

1. 新增 provider endpoint helper。
2. adapter / provider test / RAG / semantic search 共用 URL builder。
3. 新增 embedding dimension helper。
4. 统一 Node 与 Python 的 `embedDim` 传递方式。
5. 新增 `createRagContext()`。
6. 收紧 `manageRag()` action 类型。

### 第三批：前端大页面拆分

1. documents page 拆 panel。
2. library page 拆 search / table / status。
3. settings page 按 tab 拆。
4. writing page 抽 hooks / controller。
5. 统一 polling / mutation refetch。

### 第四批：document worker pipeline 化

1. 先抽纯函数：split plan、model resolution、RAG config build。
2. 再抽副作用阶段：persist chunks、embed chunks、sync FTS、index RAG。
3. 最后简化 `processDocument()`。

### 第五批：性能和并发

1. bounded file save。
2. bounded DB writes。
3. semantic split bounded concurrency。
4. LightRAG embedding cache。
5. topology animation 降低 React re-render。

## 12. 推荐最终代码边界

建议后续逐步形成如下边界：

```text
src/lib/api
  response helpers
  auth route helpers

src/lib/llm
  adapter
  provider endpoint normalization
  capability parsing
  embedding dimension resolution
  model resolution

src/lib/rag
  context builder
  LightRAG Python bridge
  graph/entity action types

src/lib/documents
  converter
  splitter
  semantic splitter
  chunk persistence
  embedding persistence
  storage

src/lib/queue/workers
  document worker orchestration only

src/lib/writing
  context assembly
  generation
  comparison
  audit
  humanize
  asset request parsing

src/components/shared
  status badge
  empty state
  loading state
  confirm action
  file/type display helpers

src/components/<feature>
  feature-specific UI only
```

设计原则：

```text
route handler 只做 auth + parse input + call service + return response
service 负责业务规则
lib helper 负责无状态复用逻辑
worker 负责 orchestration，不塞满所有细节
component 负责展示，不塞满数据协议和业务规则
```

## 13. 不建议做的事情

短期内不建议：

1. 不建议一次性大规模重写 `document-worker.ts`。
2. 不建议改变 API response shape。
3. 不建议改变 SSE event 协议。
4. 不建议改变 DB schema，除非已有充分迁移和回归测试。
5. 不建议引入 React Query / SWR 等新状态库，除非后续明确需要。
6. 不建议激进提高 SQLite 并发写入。
7. 不建议删除 LightRAG fallback。
8. 不建议把 Python fallback 逻辑和 TS fallback 逻辑继续分叉维护。
9. 不建议为了抽象而抽象 UI 组件。
10. 不建议在没有测试保护的情况下移动写作生成和引用追踪逻辑。

## 14. 后续每次优化前的检查清单

开始任何优化前，先确认：

```text
这次优化属于哪个 Phase？
是否改变 API 返回结构？
是否改变 DB schema？
是否改变 Document.status / Section.status？
是否改变 SSE event 格式？
是否改变 chunk index / filename？
是否影响 LightRAG / FTS / semantic fallback？
是否影响 SectionReference？
是否影响 asset marker？
是否涉及 API key 解密或日志？
是否需要新增测试？
是否需要手动 UI 回归？
```

如果任何答案涉及核心协议或状态变化，需要先单独设计，不应混在普通重构中。

## 15. 建议第一轮实施范围

第一轮建议只做以下内容：

```text
Phase 1 + Phase 2 的前半部分
```

具体包括：

1. capability parsing 统一。
2. countWords / file size formatter 提取。
3. ContentRenderer render version 稳定化。
4. API helper 小范围统一。
5. provider endpoint helper 设计和测试。
6. embedding dimension helper 设计和测试。
7. topology map memoization。

第一轮暂时不做：

- `processDocument()` 大拆分
- 写作 SSE 协议调整
- LightRAG Python 协议调整
- 数据库 schema 变更
- 页面大规模重构

这样可以先获得维护性收益，同时最大限度降低破坏已完成功能的风险。
