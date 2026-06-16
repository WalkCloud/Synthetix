# Synthetix 代码可维护性、可读性与性能优化路线图

> 日期：2026-06-02  
> 最近复核：2026-06-03  
> 范围：基于当前代码、`codebase-optimization-analysis-2026-05-22.md`、`maintainability-optimization-plan-2026-05-29.md`、本轮 lint/test/build baseline 和已落地改动。  
> 目标：为后续 AI 或工程师持续优化提供执行指南，优先恢复工程信号、收紧安全/协议边界、降低大 route 与大组件维护压力，并在明确热点上做性能优化。

## 1. 总体判断

Synthetix 当前已经不是“缺少架构”的阶段，而是功能闭环较完整、边界正在收敛的维护期项目。核心模块已经存在：

```text
src/app/api/v1/*        API、SSE 和业务入口
src/lib/documents/*     文档转换、切分、embedding、FTS、LightRAG indexing
src/lib/llm/*           provider、capabilities、model resolution、usage
src/lib/rag/*           RAG 上下文、LightRAG / graph 查询和管理边界
src/lib/writing/*       写作、引用、asset、export、audit
src/hooks/*             前端数据流和交互 hooks
src/components/*        UI 与 feature components
workers/python/*        转换、RAG index/query/manage、export
```

当前最需要优化的不是新增功能，而是：

- 恢复干净的工程 baseline，让 lint/test/build 能作为可靠回归信号。
- 收紧用户、Provider、DTO、模型解析和 API key 安全边界。
- 把厚 API route 中的业务流程、副作用、SSE 编码和 JSON parsing 拆到明确模块。
- 为 SSE、asset marker、JSON metadata、Node/Python 参数协议补测试保护。
- 分批拆前端大页面，降低后续修改的误伤概率。
- 只在明确热点上做性能优化，避免无证据的大规模重构。

## 功能保护执行约束

本文档是后续优化路线图，不是一次性重构授权。任何实现都必须优先保护当前已经完成的功能闭环：

```text
认证与设置
模型 Provider 管理
文档上传 / 转换 / 切分 / embedding / indexing
keyword search / semantic search / LightRAG fallback
brainstorm session / message / outline
draft 创建 / section 写作 / generate-all task
RAG references 展示和保存
A/B compare
confirm / unlock / regenerate / humanize
diagram / image asset marker 渲染与确认
markdown / pdf / docx export
```

执行原则：

- 每批优化必须是小步、可回滚、可验证的改动；不要把 baseline 修复、协议调整、UI 拆分和性能优化混在一次提交里。
- 不要为了“变薄 route”改变 API envelope、SSE event、asset marker、状态机、chunk id、FTS rowid 或 LightRAG fallback。
- 不要删除现有 fallback、兼容路径、旧字段处理或 best-effort 副作用，除非先补测试证明它们已经不再被当前功能依赖。
- 不要在没有端到端手动验证的情况下重写写作生成、asset 确认、文档处理、RAG indexing/export 这类用户可见工作流。
- 不要用大规模机械格式化、全局 import 重排或组件重写掩盖真实业务改动。
- 如果某项优化需要改变公共接口或数据库 schema，必须先单独写设计和迁移/兼容方案，不应直接按本路线图执行。
- 当前工作区可能包含已开发完成但未提交的业务改动；后续优化不得 revert、覆盖或清理这些改动，除非明确确认它们与目标冲突且获得授权。

后续实现时，任何一批优化都应能回答：

```text
这次改动保护了哪些既有功能？
哪些功能通过自动测试覆盖？
哪些功能需要手动验证？
如果失败，如何只回滚本批改动而不影响其他已完成工作？
```

## 2. 当前验证结果

本轮静态分析后验证结果：

```bash
pnpm test:run
# 通过：24 个测试文件，166 个测试

pnpm build
# 通过，但仍有 1 个 Turbopack tracing warning

pnpm lint
# 失败：2 errors / 68 warnings
```

当前 lint 的两个错误应优先处理：

- `src/app/(dashboard)/brainstorm/page.tsx`：未转义的 `'`，触发 `react/no-unescaped-entities`。
- `src/components/settings/database-tab.tsx`：render 阶段调用 `Math.random()`，触发 `react-hooks/purity`。

当前 build warning 仍指向 asset upload-image 路径相关 tracing：

```text
Encountered unexpected file in NFT list
Import trace:
  App Route:
    ./next.config.ts
    ./src/app/api/v1/drafts/[id]/sections/[secId]/assets/upload-image/route.ts
```

处理原则：

- lint error 必须先修，恢复 `pnpm lint` 可通过。
- lint warning 分模块逐步清理，不建议一次性机械清零。
- Turbopack tracing warning 建议作为单独专项处理，不混入业务重构；处理时必须验证 upload-image、generate-diagram、mermaid render、asset serve 和 export 中的本地 asset 路径仍可用。

## 3. 相对 2026-05-22 分析的完成情况

### 3.1 已完成或明显推进

- Provider API key 边界已推进：
  - `src/lib/models/provider-dto.ts` 已新增 `toProviderDto()`。
  - Provider API 对前端返回 `hasApiKey`，不再直接返回 provider 的 `apiKey`。
  - `ProviderForm` 编辑态已使用空 key 输入，避免把旧密文回填到表单。

- `embeddingDim` 保存和探测已推进：
  - Provider create/update 已写入 `embeddingDim`。
  - provider test / create / update 已集成 embedding dimension validation/probe。
  - `passDimensions` 已进入模型配置，用于区分是否需要向 provider 传 `dimensions` 参数。

- JWT 配置已收敛：
  - `src/lib/auth/token-core.ts` 已抽出 edge-safe token helper。
  - `proxy.ts` 已复用 `token-core.ts`，不再使用弱默认 secret。

- writing status 已集中：
  - `src/lib/writing/status.ts` 已集中 `DraftStatus`、`SectionStatus`、`CONFIRMED_SECTION_STATUSES`、`isSectionDone()`、`deriveDraftStatus()`。
  - `src/types/writing.ts` 保持 re-export 兼容旧引用。

- Provider probe 已抽出：
  - `src/lib/llm/provider-probe.ts` 已封装 connectivity、context window、embedding dimension probe/validate。
  - provider 外部请求已开始具备 timeout。
  - embedding probe 已开始返回 `passDimensions`，用于区分是否需要向 provider 显式传 `dimensions`。

- RAG / LightRAG 参数协议已明显推进：
  - Node 侧文档 embedding、semantic search、LightRAG index/manage/query 已开始传递 `passDimensions`。
  - Python worker 已新增 `--pass-dimensions`，并将 `send_dimensions` 与模型配置绑定。
  - Node 侧 `resolveEmbeddingDim()` 已不再使用模型名启发式作为主要事实来源，优先依赖 DB 中已验证的 `embeddingDim`。
  - Python 侧仍保留最后兜底启发式，并在 manage/query/index 中补充现有 vdb 维度读取、rerank usage 回传等逻辑。

- Rerank 边界已开始接入：
  - RAG context、semantic search、knowledge manage/entity/graph routes、document delete cleanup 已传递 `rerankConfig` / `rerankModelId`。
  - `rag_index.py`、`rag_query.py`、`rag_manage.py` 已支持 rerank function 和 `rerank_usage` 回传。
  - Node 侧已开始记录 `pipeline-rerank`、`search-rerank`、`manage-rerank` token usage。

- Queue 启动并发已改善：
  - `src/lib/queue/queue.ts` 已新增 `drain()`，启动时可填充并发槽。

### 3.2 部分完成但需要收尾

- Provider DTO 只包住 provider 层，`models` 仍直接返回 `ModelConfig[]`。当前没有敏感字段，但 DTO 边界不彻底。
- `POST /api/v1/models/providers` 已使用 Zod schema，但 `PUT /api/v1/models/providers/[id]` 仍直接解构 `request.json()` 并使用大量 cast。
- `provider-probe.ts` 已抽出，但仍存在未使用 import、空 `catch {}`、URL builder 细节重复等可维护性问题。
- `createRagContext(userId)` 接收 `userId`，但当前没有使用；`resolveModel(capability)` 仍是全局默认模型解析，没有按用户过滤。
- RAG / Python 协议已经扩展，但还缺少专门的协议测试和文档，尤其是 `embedDim`、`passDimensions`、`rerankConfig`、`rerank_usage`、cached embeddings 和 graph/basic mode 的组合。
- queue `drain()` 已存在，但任务领取不是原子 claim。单进程本地部署风险较低，多实例或并发 drain 时仍可能重复领取。
- React Compiler 相关规则仍有部分关闭，说明前端 hooks/ref/effect 模式还需要分批治理。

### 3.3 仍未完成或新暴露的问题

- lint baseline 已退化，需要优先恢复。
- `server.log` 是 tracked modified，且 `.gitignore` 没有通用 `*.log`，运行日志仍可能污染工作区。
- 写作和 asset route 仍较厚，尤其是 section generate、compare、confirm-asset、asset generation routes。
- 裸 `JSON.parse` 仍广泛存在于 `AsyncTask.inputData/resultData`、`SectionAsset.metadata`、`Section.constraints`、LLM JSON 输出、前端 SSE parser 等位置。
- 日志仍可能输出 content snippet、prompt、source、stack、RAG 原文或 rerank query preview，缺少统一脱敏策略。
- `TopologyCanvas` 的 per-frame React render 仍是明确性能热点。

## 4. 必须保持不变的核心契约

后续任何优化都必须先确认是否触碰这些契约。

### 4.1 API envelope

保持：

```ts
{ success, data?, error? }
```

可以新增 helper、schema、DTO，但不能改变前端解析依赖的响应格式。

### 4.2 状态语义

保持 `Document.status`：

```text
uploading
converting
splitting
embedding
indexing
ready
failed
```

保持 `AsyncTask.status/progress/resultData` 可被前端轮询解析。

保持 `Section.status` 与 `src/lib/writing/status.ts` 一致，不要在 route、组件或 worker 中重新定义完成状态。

### 4.3 Chunk、FTS 与 LightRAG ID

保持：

```text
DocumentChunk.index
chunk_000.md
chunk_001.md
<docId>/chunk_XXX
```

不得破坏 FTS5 与 `document_chunks.rowid` 的对应关系。

### 4.4 Semantic search fallback

保持：

```text
优先 LightRAG
失败后 fallback 到 direct embedding cosine search
```

不能为了简化逻辑删除 fallback。

### 4.5 Section generation SSE

保持事件兼容：

```text
references
reasoning
chunk
assets
done
error
```

SSE route 可以变薄，但事件类型和字段必须有测试保护后再调整。

### 4.6 引用与 asset marker

保持 `SectionReference` 关键字段：

```text
sectionId
documentId
chunkId
documentName
relevanceScore
sourceAnchor
content
```

保持内容 marker：

```text
[DIAGRAM:<assetId>]
[IMAGE:<assetId>]
```

### 4.7 API key 安全边界

保持：

- API key 不返回前端。
- API key 不写日志。
- 只在服务端调用 provider 或 Python worker 前解密。
- DTO 对前端只暴露 `hasApiKey` 等安全字段。

### 4.8 SQLite 写入并发

默认本地 SQLite 部署，写入并发必须保守。任何 batch、queue、probe 并发优化都要避免放大 SQLite 锁竞争。

## 5. 优化优先级

### P0. 恢复 lint baseline

现状：

- `pnpm test:run` 通过。
- `pnpm build` 通过但有 tracing warning。
- `pnpm lint` 失败：2 errors / 68 warnings。

风险：

- 后续 AI 修改无法可靠使用 lint 判断是否引入新问题。
- 小错误会掩盖真正的架构 warning。

建议改法：

- 修 `brainstorm/page.tsx` 文本转义问题。
- 修 `database-tab.tsx` render 阶段 `Math.random()`，改为稳定宽度数组或常量。
- 分批清理 unused import、unused vars、unused expression。
- 对 `<img>` warning 按场景判断，不要盲目替换成本地 preview 不适合的 `next/image`。
- 暂不一次性恢复所有 React Compiler 规则，按页面拆分治理。

验证：

```bash
pnpm lint
pnpm test:run
pnpm build
```

### P0. 模型解析按 userId 收敛

现状：

- `createRagContext(userId)` 接收 `userId` 但未使用。
- `resolveModel(capability)` 不按用户过滤。
- Provider 管理 API 是 user-scoped，但模型使用侧存在全局解析风险。

风险：

- 多用户或未来权限边界下，可能使用到其他用户的默认模型。
- 后续维护者会误以为 `createRagContext(userId)` 已经做了权限过滤。

建议改法：

```text
resolveModel(userId, capability)
  -> where: { provider: { userId }, ...capability/default filters }

createRagContext(userId)
  -> resolveModel(userId, "embedding")
  -> resolveModel(userId, "writing")
  -> resolveModel(userId, "rerank")
```

同时更新 writing、image、semantic search、worker 入口中所有模型解析调用。

兼容约束：

- 改造前先梳理所有 `resolveModel()` 调用点，禁止只改部分调用导致默认模型解析不一致。
- 如果当前代码存在历史默认模型或迁移数据，必须提供兼容 fallback 或一次性迁移方案。
- 改造完成前，不要删除现有 provider/model 配置字段。
- 手动验证 provider 新增、编辑、测试、文档上传 embedding、semantic search、section generation 都仍能解析到正确模型。

验证：

- 新增测试：不同用户各有默认模型时，只解析当前用户模型。
- 新增测试：当前用户无模型时不 fallback 到其他用户模型。
- 跑完整 lint/test/build。

### P1. Provider PUT schema 与 DTO 收敛

现状：

- `POST /api/v1/models/providers` 已使用 Zod schema。
- `PUT /api/v1/models/providers/[id]` 仍直接解构 body，使用大量 `Record<string, unknown>` cast。
- `toProviderDto()` 返回 `models: ModelConfig[]`，DTO 层不彻底。

风险：

- PUT 输入不合法时可能在运行时才失败。
- 未来 `ModelConfig` 增加敏感字段时，可能被 DTO 直出。
- POST/PUT 验证规则漂移。

建议改法：

- 提取共享 schema，例如 `src/lib/models/provider-schema.ts`。
- `POST` 使用 create schema，`PUT` 使用 partial/update schema，但 model item 结构共用。
- 新增 `toModelConfigDto()`，`ProviderDto.models` 返回 model DTO。
- DTO 显式列出允许返回前端的字段。

兼容约束：

- DTO 字段收敛必须保持前端当前需要的 model 信息完整，包括 `embeddingDim`、`passDimensions`、`embeddingBatchSize`、`isDefaultFor` 和 capability 信息。
- PUT schema 收敛时必须保留“空 apiKey 表示不更新旧 key”的行为。
- 不要改变 provider test 返回给前端的 `contextWindows`、`embeddingDims`、`passDimensions`、`embedDimErrors` 语义。

验证：

- GET providers 不包含 `apiKey`。
- GET provider detail 不包含 `apiKey`。
- PUT 空 key 保留旧 key。
- PUT 新 key 后能正常解密调用。
- POST/PUT 保存 `embeddingDim` 和 `passDimensions`。

### P1. SSE、asset marker 与 JSON parser 测试

现状：

- `src/lib/writing/sse-events.ts` 已存在，但协议测试仍不足。
- asset marker parse/replace 分布在多个模块和 route。
- 裸 `JSON.parse` 仍广泛存在。

风险：

- 写作生成 route service 化时容易破坏前端 SSE parser。
- asset marker 替换失败可能导致内容和 asset 状态不一致。
- DB JSON 字段损坏时 route 可能直接抛错。

建议改法：

新增或完善：

```text
src/__tests__/writing/sse-events.test.ts
src/__tests__/writing/marker-parser.test.ts
src/__tests__/writing/asset-pipeline.test.ts
src/__tests__/queue/task-json.test.ts
```

新增 parser/helper：

```text
src/lib/queue/task-json.ts
src/lib/writing/section-metadata.ts
src/lib/writing/asset-metadata.ts
```

验证重点：

- `references/reasoning/chunk/assets/done/error` 序列化格式稳定。
- 错误事件总是 JSON-safe。
- `[DIAGRAM:<id>]`、`[IMAGE:<id>]` parse/replace 稳定。
- 旧 metadata 或损坏 JSON 有 fallback，不直接崩溃。

### P1. RAG / LightRAG Node-Python 协议测试

现状：

- Node 侧已将 `embedDim`、`passDimensions`、`rerankConfig`、`rerankModelId` 传入 LightRAG index/query/manage/delete 流程。
- Python worker 已新增 `--pass-dimensions`，并在 query/index/manage 中支持 rerank function 和 `rerank_usage` 回传。
- document pipeline 已在 graph mode 不兼容时降级 basic，并把 `requestedIndexMode`、`warnings` 写入 task result。
- `resolveEmbeddingDim()` 当前主要依赖 DB 中已验证的 `embeddingDim`，不再在 Node 侧做模型名启发式探测。

风险：

- 任意一端参数名、默认值、维度策略或 usage 回传 shape 漂移，都可能导致 LightRAG indexing/query/manage 在运行时失败。
- `passDimensions` 误传会让部分 embedding provider 拒绝请求，漏传则会导致可变维度模型无法按预期输出高维向量。
- rerank 日志和 stderr 透传可能输出 query preview，需要纳入日志脱敏策略。

建议改法：

新增协议文档：

```text
docs/node-python-worker-contract.md
```

新增或补充测试：

```text
src/__tests__/rag/manage-options.test.ts
src/__tests__/rag/context.test.ts
src/__tests__/rag/light-rag-args.test.ts
```

覆盖：

- `passDimensions=true` 时 index/query/manage 都带 `--pass-dimensions`。
- `passDimensions=false` 时不传 `--pass-dimensions`。
- `embedDim=0`、cached embeddings、graph/basic mode 的参数组合稳定。
- `rerankConfig` 存在时传 rerank API 参数和 `rerankModelId`，并能记录 `rerank_usage`。
- graph mode 维度不足时降级 basic，且 task result 保留 warning。

兼容约束：

- 不要在未补测试前删除 Python 侧最后兜底启发式。
- 不要改变 `rerank_usage` 回传字段，除非 Node 侧 usage 记录同步更新。
- 不要改变 cached embeddings 的优先级；有缓存时仍应避免重复传 embedding config 触发不必要的 provider 请求。

### P1. 写作与 asset route 变薄

现状：

- section generate、compare、humanize、confirm-asset、asset generation routes 仍混合 auth、DB、LLM、SSE、JSON parsing、日志、副作用。

风险：

- 单个异常点影响整条链路。
- 很难测试“内容成功但 asset 失败”“引用保存成功但生成失败”“客户端断开但服务端继续写 DB”等情况。
- 后续 AI 修改 route 时容易破坏协议。

建议顺序：

1. 先抽纯函数：
   - SSE event builder
   - asset marker replacement
   - metadata parse/merge
   - reference persistence mapper
2. 再抽 best-effort 副作用：
   - token usage record
   - audit enqueue
   - asset generation fallback
3. 最后抽 use-case：
   - `generateSectionUseCase()`
   - `compareSectionUseCase()`
   - `confirmAssetUseCase()`

约束：

- 不改 SSE event 协议。
- 不改 API envelope。
- 不改 marker 格式。
- 不改 DB schema。

### P2. 日志脱敏与统一 logger

现状：

- `console.log/warn/error` 分布在 LLM、RAG、asset、worker、route、hooks 中。
- 部分日志可能输出 content snippet、source、prompt、stack 或 RAG 原文。

风险：

- API key、prompt、文档原文或生成内容可能进入日志。
- 生产环境定位问题时缺少统一 request/task/section id。

建议改法：

新增：

```text
src/lib/logger.ts
```

能力：

```text
debug/info/warn/error
LOG_LEVEL
redact()
默认生产环境不输出 prompt/content/API key/RAG 原文
```

替换优先级：

1. `confirm-asset` 中的 content/source 日志。
2. LLM/RAG fallback error。
3. writing generation / audit / asset generation 日志。
4. frontend hooks 中的重复 console。

验证：

- 单测 `redact()`。
- 手动确认错误日志只保留 id、状态、错误摘要。

### P2. Turbopack tracing warning 专项

现状：

- build 通过，但 asset upload route 相关 tracing warning 仍存在。

风险：

- 可能导致 standalone/server trace 包含过多项目文件。
- warning 长期存在会降低 build 输出的信噪比。

建议改法：

- 将 section asset 路径封装成静态 scoped helper。
- 路径固定落在：

```text
path.join(process.cwd(), "data", "assets", "sections", ...)
```

- 避免从 route 中引入会动态读取项目根目录的模块。
- 必要时按 Turbopack 提示使用 ignore comment，但优先静态约束路径。

兼容约束：

- 不能改变已生成 asset 的存储位置和访问 URL 语义。
- 不能破坏 upload image、diagram render、image generation、asset serve、export inline assets 对同一路径规则的依赖。
- 如果封装路径 helper，必须先确认所有 section asset routes 使用同一个 helper，再做路径调整。

验证：

```bash
pnpm build
```

确认 tracing warning 消失或明确可解释。

### P2. 前端大页面拆分

现状：

- `writing/[id]/page.tsx`、`brainstorm/page.tsx`、`models-tabs.tsx`、`library/page.tsx`、`reference-panel.tsx` 仍是维护压力点。

建议顺序：

1. `brainstorm/page.tsx`：继续拆 session list、conversation panel、outline preview。
2. `models` 页面：拆 provider CRUD、model list、usage analytics、probe result。
3. `library` 页面：拆搜索状态、批处理、文档表格。
4. `writing/[id]`：只按 hook/区域渐进拆，不做一次性重写。

原则：

- 先抽展示组件，再抽 hooks。
- 每次只抽一个区域。
- 不同时改 UI 文案、API、状态机。
- 拆完必须跑 lint/test/build。

### P2. 性能与并发专项

明确热点：

- `TopologyCanvas` 仍可能通过 `requestAnimationFrame -> setTick()` 触发 React 每帧渲染。
- provider probe 可以 bounded concurrency，但 DB 写入仍应顺序或小事务。
- queue `drain()` 启动并发已改善，但任务 claim 不是原子操作。
- cancel 仍是 cooperative cancel，无法真正中止已经运行的 Python/LLM 调用。

建议改法：

- Topology 交互优先用 ref/CSS transform 局部更新，减少 React 每帧 render。
- queue 增加原子 claim 或事务保护，避免多 worker 重复领取。
- 长任务在阶段间增加 cancellation check。
- 需要中止外部调用时逐步引入 `AbortSignal`。

## 6. 推荐执行批次

### Batch 1：恢复 baseline

目标：

- `pnpm lint` 恢复通过。
- 工作区运行日志污染单独处理。
- 不改变任何用户可见功能。

任务：

1. 修两个 lint error。
2. 清理明显 unused import/vars。
3. 修少量 unused expression。
4. 为 `*.log` 或具体运行日志制定 gitignore/清理策略。

禁止：

- 不要删除或改写当前 tracked 的运行日志，除非单独确认它们不是用户需要保留的内容。
- 不要为了清理 warning 重写业务组件。

验证：

```bash
pnpm lint
pnpm test:run
pnpm build
```

### Batch 2：Provider 与模型解析边界

目标：

- Provider POST/PUT 输入规则一致。
- DTO 不直出 Prisma model。
- 模型解析按用户过滤。
- 保持当前 provider 管理、模型测试、文档 embedding、写作生成可用。

任务：

1. 提取 provider schema。
2. 新增 model config DTO。
3. 改造 PUT route。
4. 改 `resolveModel(userId, capability)`。
5. 更新 RAG/writing/image/worker 调用点。

验证：

- Provider API key 不返回前端。
- 空 key 保留旧 key。
- `embeddingDim` 保存和探测稳定。
- 多用户模型解析测试通过。

### Batch 3：RAG / LightRAG 协议保护

目标：

- 保护当前已接入的 `passDimensions`、rerank、graph/basic downgrade、Python worker 参数协议。
- 先补 Node/Python 参数测试，再继续重构 RAG 或 provider probe。

任务：

1. 新增 Node/Python worker contract 文档。
2. 补 LightRAG index/query/manage 参数测试。
3. 补 `rerank_usage` 回传与 token usage 记录测试。
4. 补 graph mode 降级 warning 的 task result 测试。
5. 复核 Python stderr/query preview 是否需要脱敏。

验证：

```bash
pnpm test:run
pnpm lint
pnpm build
```

涉及真实 provider 时手动验证：

- embedding model 未设置 `embeddingDim` 时 provider test 能探测并保存。
- `passDimensions=true` 的 embedding model 能完成文档 embedding 和 semantic search。
- graph mode 低维模型会降级 basic，并在 task result 中保留 warning。
- rerank model 配置后 search/manage/index 能返回结果并记录 usage。

### Batch 4：SSE、asset marker 与 JSON parser

目标：

- 写作 SSE、asset marker、metadata JSON 有测试保护。
- 先补保护网，再改生成流程。

任务：

1. 补 SSE event tests。
2. 补 marker parser/replace tests。
3. 新增 AsyncTask JSON parse helper。
4. 新增 SectionAsset metadata parse helper。
5. 替换高风险裸 `JSON.parse`。

验证：

```bash
pnpm test:run
pnpm lint
pnpm build
```

### Batch 5：写作 route service 化

目标：

- route 只保留 auth、validate、调用 use-case、返回 response/SSE。
- 不改变 section generation 的用户可见行为。

任务：

1. 抽 generate route 纯函数。
2. 抽 token usage/audit best-effort helper。
3. 抽 asset marker placement 和 confirm use-case。
4. 抽 compare route use-case。

验证：

- 单章节 SSE generation。
- references 展示和保存。
- A/B compare。
- confirm/unlock/regenerate。
- humanize。
- generate-all task。
- asset marker 渲染。

### Batch 6：日志与 build warning

目标：

- 日志默认脱敏。
- build tracing warning 消除或有明确说明。
- 不改变 asset 文件位置、URL 或 export 行为。

任务：

1. 新增 logger。
2. 替换高风险 console。
3. 封装 asset storage path。
4. 修 Turbopack tracing warning。

验证：

```bash
pnpm build
pnpm lint
pnpm test:run
```

### Batch 7：前端拆分与性能专项

目标：

- 降低大页面维护压力。
- 优化明确热点。
- 保持现有 UI 工作流和交互入口。

任务：

1. 拆 brainstorm 页面。
2. 拆 models 页面。
3. 拆 library 页面。
4. 渐进拆 writing detail。
5. 优化 TopologyCanvas per-frame render。
6. 恢复部分 React Compiler 规则。

禁止：

- 不要一次性重写 `writing/[id]`。
- 不要同步改 UI 文案、API、数据结构和交互逻辑。
- 不要引入新的全局状态库替代现有 hooks。

验证：

- setup/login。
- provider 新增、编辑、测试。
- 文档上传到 ready。
- keyword/semantic search。
- brainstorm session 和 outline generation。
- draft 创建和写作详情加载。
- section generation。
- export。

## 7. 每次优化前检查清单

开始修改前先确认：

```text
这次是否改变 API response shape？
是否改变 Document.status / Section.status / AsyncTask.status？
是否改变 SSE event 类型或字段？
是否改变 asset marker 格式？
是否改变 chunk index、chunk 文件名、LightRAG chunk id？
是否影响 FTS rowid 对齐？
是否可能向前端或日志泄露 API key / prompt / 文档原文 / 生成内容？
是否涉及 SQLite 写入并发？
是否新增裸 JSON.parse？
是否把 Prisma model 直接返回给前端？
是否需要新增或更新测试？
是否会删除当前已存在的 fallback 或兼容逻辑？
是否会改变用户已经生成的文档、draft、section、asset 的读取方式？
是否会改变 Node/Python worker 参数名、默认值或返回 JSON shape？
是否会改变 `embeddingDim` / `passDimensions` / `rerank_usage` 的语义？
```

如果触碰核心契约，应先补测试或单独设计，不要混在普通 refactor 中。

## 8. 最低验证矩阵

每批优化至少运行：

```bash
pnpm test:run
pnpm lint
pnpm build
```

涉及 UI 或交互时，手动验证：

```text
setup / login / refresh token
provider 新增、编辑、测试
文档上传到 ready
keyword search
semantic search
LightRAG 不可用时 fallback
brainstorm session 创建、消息、outline
draft 创建和详情加载
单章节 SSE 生成
RAG references 展示和保存
A/B compare
confirm / unlock / regenerate
full draft generation task
diagram/image asset marker 渲染
export markdown/pdf/docx
```

## 9. 不建议短期做的事情

- 不建议一次性重写 writing generation route。
- 不建议改 API envelope。
- 不建议改 SSE event 协议。
- 不建议改 chunk 命名或 LightRAG chunk id。
- 不建议在未补测试前改 section 状态机。
- 不建议激进提高 SQLite 写并发。
- 不建议引入 React Query/SWR，除非先证明现有 hooks 无法维护。
- 不建议把所有 lint warning 一次性机械清零。
- 不建议把 Python worker 和 Node 侧协议同时大改。
- 不建议把 UI 组件抽象成过早通用的大型框架。
- 不建议在没有迁移/兼容方案时调整数据库 schema 或文件存储路径。
- 不建议为了消除 warning 删除当前用户实际使用的 fallback、日志上下文或错误处理分支。
- 不建议在没有协议测试时继续扩展 LightRAG index/query/manage 参数。

## 10. 目标边界

后续逐步收敛到：

```text
src/app/api/v1/*
  auth + validate + call use-case + response/SSE

src/lib/api
  response helpers + DTO mappers + body schemas

src/lib/auth
  token-core + session + password

src/lib/models
  provider schema + provider/model DTO + user-scoped model resolution boundary

src/lib/llm
  adapter + provider endpoints + provider probe + capabilities + usage

src/lib/rag
  context builder + LightRAG bridge + graph/entity action types

src/lib/documents
  converter + splitter + pipeline stages + storage + embedding persistence

src/lib/writing
  status + context assembly + generation use-cases + assets + export + audit

src/lib/queue
  queue orchestration + task JSON helpers + worker registration + cooperative cancellation

src/components/<feature>
  feature UI

src/hooks/<feature>
  feature data flow and interaction hooks
```

最终目标不是抽象更多，而是让后续维护者或 AI 能快速定位事实来源、协议入口、测试保护和副作用边界。
