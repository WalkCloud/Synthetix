# Synthetix 可维护性与 AI 后续开发优化方案

> 日期：2026-05-29  
> 范围：基于当前仓库静态扫描、lint/test/build baseline、既有优化文档和本轮已落地改动。  
> 目标：提升代码可读性、可维护性和后续 AI 修复/新增功能的效率，优先减少误伤核心协议与业务流程的风险。

## 1. 总体判断

Synthetix 当前已经不是“无结构代码”，而是一个功能闭环较完整、正在进入维护期的 Next.js + Prisma + Python workers 项目。核心边界已经存在：

- `src/app/api/v1/*`：REST API 和 SSE 入口。
- `src/lib/documents/*`：文档转换、切分、embedding、FTS、LightRAG indexing。
- `src/lib/llm/*`：provider、capabilities、model resolution、usage。
- `src/lib/rag/*`：LightRAG / graph 查询与管理边界。
- `src/lib/writing/*`：写作、引用、asset、export、audit。
- `src/hooks/*` 与 `src/components/*`：前端数据流和 UI。
- `workers/python/*`：转换、RAG index/query/manage、export。

目前最影响 AI 后续开发效率的问题不是缺少功能，而是：

1. 工程信号曾经不干净：lint 被临时目录和 React Compiler 新规则打爆，test 有超时失败。
2. 部分协议散落：SSE event、asset marker、writing status、JSON metadata 规则不够集中。
3. 部分 route 仍偏厚：auth、validate、DB、业务流程、LLM/RAG、SSE 编码混在一起。
4. 类型边界仍有宽口：`any`、裸 `JSON.parse`、Prisma model 直出 DTO 的风险还没有完全清理。
5. 日志和副作用边界较散：`console.warn/error` 分布在 LLM、RAG、asset、worker 流程里，缺少统一脱敏策略。

## 2. 本轮已经完成的优化

本轮先建立可用 baseline，保证后续优化有可靠回归信号。

### 2.1 lint/test/build baseline

已完成：

- `pnpm test:run` 通过：24 个测试文件，166 个测试通过。
- `pnpm lint` 通过：0 errors，仍有 warnings。
- `pnpm build` 通过。
- `eslint.config.mjs` 排除 `tmp/`、`tmp-chrome-profile/`、`data/`、`workers/python/__pycache__/`。
- `.gitignore` 增加 `__pycache__/` 和 `*.pyc`。
- 暂时关闭以下 React Compiler 迁移型 lint 规则：
  - `react-hooks/preserve-manual-memoization`
  - `react-hooks/refs`
  - `react-hooks/set-state-in-effect`

说明：这些规则暴露的是后续前端架构整理方向，但当前一次性修复会触及大量页面和 hooks，不适合作为 baseline 修复混入。

### 2.2 converter 测试超时修复

已完成：

- `src/lib/documents/converter.ts` 在调用 Python worker 前先检查输入文件是否存在。
- `src/__tests__/documents/converter.test.ts` 改为 `rejects.toThrow()`。

收益：

- 不存在文件时快速失败，不再等待 Python worker 超时。
- 测试错误更明确，后续 AI 不会误判为 Python worker 或 Vitest 配置问题。

### 2.3 writing status domain module

已完成：

- 新增 `src/lib/writing/status.ts`，集中：
  - `DraftStatus`
  - `SectionStatus`
  - `CONFIRMED_SECTION_STATUSES`
  - `isSectionDone()`
  - `deriveDraftStatus()`
- `src/types/writing.ts` 保留 re-export，兼容旧引用。
- 主要业务引用逐步迁到 `@/lib/writing/status`。

收益：

- 状态规则从“types 文件里夹业务逻辑”迁到 writing domain。
- 后续 AI 修改 section/draft 状态时有明确入口，减少 UI、API、export 各改一套的风险。

### 2.4 lint 硬错误清理

已完成：

- 修复 `module` 变量名触发 Next.js 规则的问题。
- 修复拓扑页 `<a href="/writing">`，改为 Next `Link`。
- 清理若干 `any`：
  - diagram parse
  - diagram translate
  - image generation response
  - outline patch Prisma create data
  - topology node entity type
- brainstorm hooks/page 去掉 `setSessions as any`，并把 scroll ref 放回页面层。

## 3. 必须保持不变的系统契约

后续所有 AI 代码修复和 feature 增加，都必须先检查是否触碰这些契约。

### 3.1 API envelope

保持：

```ts
{ success, data?, error? }
```

不能随意改成别的响应格式。可以统一 helper 和 DTO，但不能破坏前端解析。

### 3.2 文档处理状态

保持现有 `Document.status` 语义：

```text
uploading
converting
splitting
embedding
indexing
ready
failed
```

`AsyncTask.status/progress/resultData` 也必须保持前端轮询可解析。

### 3.3 chunk 与 LightRAG ID

保持：

```text
DocumentChunk.index
chunk_000.md
chunk_001.md
<docId>/chunk_XXX
```

FTS5 与 `document_chunks.rowid` 的对应关系不能破坏。

### 3.4 semantic search fallback

保持：

```text
优先 LightRAG
失败后 fallback 到 direct embedding cosine search
```

不能为了简化逻辑删除 fallback。

### 3.5 section generation SSE

保持事件兼容：

```text
references
reasoning
chunk
assets
done
error
```

前端 parser、写作页、asset 流程依赖这些事件。

### 3.6 引用与 asset marker

保持 `SectionReference` 关键字段：

- `sectionId`
- `documentId`
- `chunkId`
- `documentName`
- `relevanceScore`
- `sourceAnchor`
- `content`

保持内容 marker：

```text
[DIAGRAM:<assetId>]
[IMAGE:<assetId>]
```

### 3.7 API key 安全边界

保持：

- API key 不返回前端。
- API key 不写日志。
- 只在服务端调用 provider / Python worker 前解密。
- DTO 对前端只暴露 `hasApiKey` 这类安全字段。

### 3.8 SQLite 并发保守

默认 SQLite 本地部署，不应激进提高写入并发。任何 batch/queue 优化都要考虑锁竞争。

## 4. 后续优化优先级

### Phase 1：继续清理 baseline warnings

目标：让 `pnpm lint` 不只是通过，而是 warning 数量持续下降。

优先处理：

- 未使用 import / 变量。
- `react-hooks/exhaustive-deps`。
- 明显无效表达式。
- 可局部替换的 `<img>` warning，不能盲目替换会破坏本地 asset/preview 的场景。

暂不建议立刻处理：

- 大量 `set-state-in-effect` 重构。
- `refs during render` 相关模式大迁移。

这些需要按页面拆分，不适合一次性机械改。

### Phase 2：API route 继续变薄

目标结构：

```text
route handler
  -> auth
  -> parse/validate input
  -> call use-case/service
  -> return response or SSE

service/use-case
  -> business rule
  -> DB mutation
  -> LLM/RAG/worker calls

lib helper
  -> stateless utility
```

优先拆：

- `drafts/[id]/sections/[secId]/generate`
- `compare`
- `humanize`
- asset generation routes
- provider test route
- knowledge manage route

约束：

- 不改 SSE 协议。
- 不改 API envelope。
- 不改 DB schema。
- 先抽纯函数，再抽副作用阶段，最后移动 orchestration。

### Phase 3：DTO 与 JSON schema 收敛

目标：减少 Prisma model、JSON 字符串字段、前端响应之间的隐式耦合。

建议新增或继续完善：

```text
src/lib/api/dto/
  providers.ts
  documents.ts
  drafts.ts
  tasks.ts
```

建议增加 schema/guard：

- `Section.constraints`
- `Draft.outline`
- `SectionAsset.metadata`
- `AsyncTask.inputData/resultData`
- LLM JSON 输出
- diagram JSON
- image provider response

原则：

- 外部输入用 Zod 或明确 type guard。
- DB JSON 字段解析必须有 fallback。
- LLM 输出先当 `unknown`，校验后再进入业务逻辑。

### Phase 4：SSE 与 asset 协议测试

目标：让 AI 后续改写作生成流程时不破坏前端协议。

建议新增测试：

```text
src/__tests__/writing/sse-events.test.ts
src/__tests__/writing/marker-parser.test.ts
src/__tests__/writing/asset-pipeline.test.ts
```

覆盖：

- `references/reasoning/chunk/assets/done/error` 序列化格式。
- 错误事件不能抛出非 JSON。
- `[DIAGRAM:<id>]`、`[IMAGE:<id>]` marker parse/replace。
- request marker 到 confirmed asset marker 的替换。

### Phase 5：前端页面拆分

优先级：

1. `brainstorm/page.tsx`
2. `models` 页面
3. `library` 页面
4. `writing/[id]` 剩余 header/layout 行为

建议拆法：

```text
BrainstormPage
  SessionList
  ConversationPanel
  MessageComposer
  OutlinePreviewPanel
  useBrainstormSessions
  useBrainstormChat
  useBrainstormOutline
```

原则：

- 先抽展示组件，后抽 hooks。
- 每次只抽一个区域。
- 不同时改交互文案、API、状态机。
- 拆完必须跑 lint/test/build。

### Phase 6：日志与错误边界

建议新增：

```text
src/lib/logger.ts
```

能力：

- `debug/info/warn/error`
- `LOG_LEVEL`
- `redact()`
- 默认生产环境不输出 prompt、全文内容、API key、RAG 原文。

逐步替换：

- `console.warn`
- `console.error`
- LLM/RAG/asset/worker 中可能包含内容片段的日志。

### Phase 7：Node/Python 协议文档化

建议新增：

```text
docs/node-python-worker-contract.md
```

覆盖：

- convert worker 输入/输出。
- rag_index/query/manage 参数。
- embedding dimension 优先级。
- provider key 解密边界。
- LightRAG graph/basic 模式降级逻辑。
- Python fallback 只作为最后兜底。

## 5. 当前已知技术债

### 5.1 Turbopack tracing warning

`pnpm build` 通过，但仍有 warning：

```text
Encountered unexpected file in NFT list
Import trace:
  App Route:
    ./next.config.ts
    ./src/app/api/v1/drafts/[id]/sections/[secId]/assets/upload-image/route.ts
```

原因方向：

- upload image route 或相关 helper 中存在动态 `path.join(process.cwd(), ...)` / filesystem 操作，Turbopack 认为可能 tracing 整个项目。

建议后续专项处理：

- 将 asset 路径封装成静态 scoped helper。
- 让所有 asset 路径都落在 `path.join(process.cwd(), "data", "assets", ...)`。
- 必要时按 Turbopack 提示使用 ignore comment。

不建议：

- 在没有回归测试时大改 upload/serve/export asset 路径。

### 5.2 lint warnings

当前 lint 已 0 errors，但仍有 warnings，主要包括：

- 未使用变量/导入。
- React hook dependency。
- `<img>` 建议改 Next Image。
- 少量 unused expression。

建议逐模块清理，不要一次性全局机械修改。

### 5.3 React Compiler 规则暂时关闭

当前关闭的三条规则是临时 baseline 策略，不代表问题不存在。

后续应按页面逐步处理：

- 不在 render 阶段写 ref。
- 避免 effect 中同步 setState 的派生状态。
- 减少手写 memo dependency 与 compiler 推断冲突。

## 6. 推荐后续落地顺序

### 第一批：baseline 完善

1. 清理未使用 import/变量 warning。
2. 补 `sse-events` 和 marker parser 测试。
3. 给 `AsyncTask` input/result 增加 parse helper。
4. 给 `SectionAsset.metadata` 增加 parse helper。
5. 修 Turbopack tracing warning。

### 第二批：写作 route service 化

1. 抽 section generation 阶段函数。
2. 抽 reference persistence 和 asset request 创建。
3. 抽 usage/audit best-effort helper。
4. route 只保留 SSE 编码。

### 第三批：前端页面拆分

1. 拆 `brainstorm/page.tsx`。
2. 拆 models tabs 剩余业务。
3. 拆 library 搜索/表格/批处理。
4. 逐步恢复 React Compiler 规则。

### 第四批：日志与协议文档

1. 新增 logger。
2. 替换高风险 console。
3. 编写 Node/Python worker contract。
4. 为 provider/RAG 参数协议补 fixture 测试。

## 7. 每次 AI 开发前检查清单

开始修改前先确认：

```text
这次是否改变 API response shape？
是否改变 Document.status / Section.status / AsyncTask.status？
是否改变 SSE event 类型或字段？
是否改变 asset marker 格式？
是否改变 chunk index、chunk 文件名、LightRAG chunk id？
是否影响 FTS rowid 对齐？
是否可能向前端或日志泄露 API key / prompt / 原文？
是否涉及 SQLite 写入并发？
是否新增裸 JSON.parse？
是否把 Prisma model 直接返回给前端？
是否需要新增或更新测试？
```

如果答案触碰核心契约，应先单独设计，不要混在普通 refactor 中。

## 8. 每次优化后的最低验证

至少运行：

```bash
pnpm test:run
pnpm lint
pnpm build
```

涉及 UI/交互时手动验证：

- setup/login
- provider 新增、编辑、测试
- 文档上传到 ready
- keyword search / semantic search
- brainstorm session、outline generation
- draft 创建和写作详情加载
- section SSE generation
- references 展示
- confirm/unlock/regenerate
- asset marker 渲染
- export

## 9. 不建议短期做的事情

- 不建议一次性重写 writing generation route。
- 不建议改 API envelope。
- 不建议改 SSE 协议。
- 不建议改 chunk 命名或 LightRAG chunk id。
- 不建议在未补测试前改 section 状态机。
- 不建议激进提高 SQLite 写并发。
- 不建议引入 React Query/SWR 这类新状态库，除非先证明现有 hooks 无法维护。
- 不建议把所有 warning 一次性机械清零。
- 不建议把 Python worker 和 Node 侧协议同时大改。

## 10. 目标代码边界

建议逐步收敛到：

```text
src/app/api/v1/*
  auth + validate + call use-case + response/SSE

src/lib/api
  response helpers + DTO mappers + body schemas

src/lib/auth
  token-core + session + password

src/lib/llm
  adapter + provider endpoints + provider probe + capabilities + model resolution

src/lib/rag
  context builder + LightRAG bridge + graph/entity action types

src/lib/documents
  converter + splitter + pipeline stages + storage + embedding persistence

src/lib/writing
  status + context assembly + generation use-cases + assets + export + audit

src/lib/queue
  queue orchestration + worker registration + cooperative cancellation

src/components/<feature>
  feature UI

src/hooks/<feature>
  feature data flow and interaction hooks
```

最终目标不是抽象更多，而是让 AI 修改代码时能快速定位事实来源、协议入口、测试保护和副作用边界。
