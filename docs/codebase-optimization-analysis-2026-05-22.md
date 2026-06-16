# Synthetix 代码现状分析与优化设计

> 日期：2026-05-22  
> 范围：静态阅读当前仓库源码、文档、Prisma schema、Next.js API routes、React 组件、Node/Python worker 边界。  
> 目标：从可读性、可维护性、代码简洁性和架构合理性角度设计优化内容；所有建议都以不破坏已完成功能为前提。  
> 本文档只做分析和设计，不要求立即改动业务代码。

## 1. 总体判断

Synthetix 当前已经形成了较完整的产品闭环：

```text
认证与设置
-> 模型 Provider 管理
-> 文档上传/转换/切分/索引
-> FTS + semantic search + LightRAG
-> brainstorm / outline
-> draft / section 写作
-> 引用追踪 / A-B 对比 / humanize / diagram / image assets
-> export
```

代码整体不是“没有架构”，而是已经进入第二阶段：功能边界基本存在，但若继续叠加功能，最容易出问题的是状态语义、Provider 密钥边界、LLM/RAG 参数边界、写作 SSE 流程和大组件维护成本。

当前已有一些积极改进：

- `src/lib/documents/pipeline.ts` 已把文档处理从 worker 中拆出阶段函数。
- `src/lib/llm/provider-endpoints.ts` 已开始统一 provider URL 构造。
- `src/lib/rag/context.ts` 已开始统一 RAG 上下文构建。
- `src/lib/text/*`、`src/components/shared/*`、`src/hooks/*` 已开始沉淀共享工具。
- `src/types/writing.ts` 已尝试集中管理 section 完成状态。

后续优化不应推翻这些边界，而应继续收紧它们。

## 2. 必须保持不变的功能契约

这些契约一旦变动，极容易破坏现有功能：

- API envelope 保持 `{ success, data?, error? }`。
- `Document.status` 保持当前上传处理语义：`uploading/converting/splitting/embedding/indexing/ready/failed`。
- `AsyncTask.status/progress/resultData` 保持前端轮询可解析。
- `DocumentChunk.index`、`chunk_000.md` 等文件命名、LightRAG chunk id 规则保持稳定。
- FTS5 与 `document_chunks.rowid` 的对应关系不能被破坏。
- semantic search 保留 LightRAG 失败后的直接 embedding fallback。
- section generation SSE 事件保持兼容：`references/reasoning/chunk/assets/done/error`。
- `SectionReference` 不能丢失引用追踪字段。
- 内容中的 `[DIAGRAM:<assetId>]`、`[IMAGE:<assetId>]` marker 保持兼容。
- API key 只允许在服务端调用 provider/worker 前解密，不应返回前端或进入日志。
- SQLite 写入并发保持保守。

## 3. 高优先级风险

### P0. Provider API key 被原样返回到前端，且编辑时可能二次加密

涉及位置：

- `src/app/api/v1/models/providers/route.ts`
- `src/app/api/v1/models/providers/[id]/route.ts`
- `src/components/models/provider-form.tsx`
- `src/components/models/types.ts`

现状：

- providers API 直接返回 Prisma `ModelProvider`，其中包含数据库里的 `apiKey` 字段。
- `ProviderForm` 编辑时用 `provider?.apiKey || ""` 初始化密码输入框。
- 如果用户编辑 provider 但不清空该输入框，PUT 会把已加密的密文当作明文再次 `encrypt()`，导致后续 provider 调用解密后得到旧密文，连接失败。

影响：

- 安全边界不清晰：即使是密文，也不应作为 API 字段返回前端。
- 可维护性风险：前端类型暗示 `apiKey` 可用，后续组件容易继续误用。
- 功能风险：编辑 provider 后可能破坏已有 API key。

优化设计：

- 新增 provider DTO mapper，例如 `toProviderDto(provider)`。
- 对前端只返回 `hasApiKey: boolean`，不返回 `apiKey`。
- `Provider` 前端类型移除 `apiKey`，改为 `hasApiKey?: boolean`。
- `ProviderForm` 编辑态密码框始终为空，placeholder 显示“留空则保留当前密钥”。
- PUT 只有在 `apiKey` 是用户新输入的非空值时才更新密钥。
- 增加测试：GET providers 不包含 `apiKey`；PUT 空 key 不改变密钥；PUT 新 key 后能正常解密调用。

### P0. 手动 embedding dimension 未在创建/编辑模型时持久化

涉及位置：

- `src/app/api/v1/models/providers/route.ts`
- `src/app/api/v1/models/providers/[id]/route.ts`
- `src/components/models/provider-form.tsx`
- `src/lib/rag/dimension.ts`

现状：

- `modelConfigSchema` 接收 `embeddingDim`。
- `ProviderForm` 也提交 `embeddingDim`。
- 但 POST/PUT 创建 `ModelConfig` 时没有写入 `embeddingDim`。
- provider test 可以探测并更新维度，但用户手工填写的维度在保存时会丢失。

影响：

- 用户以为已配置图谱所需维度，但实际 DB 中为空。
- RAG/LightRAG graph 模式会依赖探测或启发式 fallback，结果不可预测。

优化设计：

- POST/PUT 的 `models.create` 明确写入 `embeddingDim`。
- 对 embedding model 允许 `embeddingDim` 为空；若填写则保存。
- provider test 负责验证并更新，但不能替代保存动作。
- 增加测试：创建/编辑 embedding model 后 `embeddingDim` 保留。

### P1. JWT 逻辑在 `proxy.ts` 与 `src/lib/auth/jwt.ts` 中重复且配置语义不一致

涉及位置：

- `src/proxy.ts`
- `src/lib/auth/jwt.ts`
- `src/lib/auth/session.ts`

现状：

- `src/lib/auth/jwt.ts` 要求 `JWT_SECRET` 必须存在。
- `src/proxy.ts` 使用 `process.env.JWT_SECRET || "default-secret-change-me"`。
- token 过期时间在 proxy 中写死为 `15m/7d`，而 `jwt.ts` 支持 `JWT_ACCESS_EXPIRES/JWT_REFRESH_EXPIRES`。

影响：

- 部署时如果缺失 `JWT_SECRET`，业务层和 proxy 层行为不一致。
- 修改 token 过期配置后，proxy 刷新的 token 仍使用硬编码时间。
- 安全配置散落，后续维护者容易只改一处。

优化设计：

- 提取 edge-safe 的 JWT config/helper，例如 `src/lib/auth/token-core.ts`，只依赖 `jose` 和环境变量，不依赖 `next/headers`。
- `jwt.ts`、`session.ts`、`proxy.ts` 共用签名/验证/过期配置。
- proxy 中去掉默认弱 secret，缺失配置时统一失败。
- 增加测试覆盖 token 过期配置和 proxy-compatible helper。

### P1. Draft/Section 状态模型正在收敛，但当前存在不一致

涉及位置：

- `src/types/writing.ts`
- `prisma/schema.prisma`
- `src/lib/text/status-labels.ts`
- `src/__tests__/text/status-labels.test.ts`
- `docs/writing-system-analysis.md`
- `docs/requirements-analysis.md`

现状：

- `DraftStatus` 类型现在只有 `drafting | completed`。
- Prisma 注释和现有测试仍包含 `assembling`。
- 文档中仍提到 `accepted`。
- `src/app/api/v1/drafts/route.ts` 当前导入了 `CONFIRMED_SECTION_STATUSES` 但没有使用，可能触发 lint。

影响：

- 类型、数据库注释、文档、UI 文案、测试之间语义漂移。
- 后续任何状态相关优化都可能产生“看起来正确但破坏列表进度/导出/上下文选择”的问题。

优化设计：

- 先确认业务状态机是否最终保留 `assembling` 和 `accepted`。
- 若不保留，统一删除文档和测试中的遗留状态。
- 若保留，则恢复类型并明确何时进入。
- 建议将状态集中到一个 domain module：

```text
src/lib/writing/status.ts
  SECTION_STATUSES
  CONFIRMED_SECTION_STATUSES
  isSectionDone()
  isSectionEditable()
  deriveDraftStatus()
  draftStatusLabels
  sectionStatusLabels
```

- API route、组件、导出、worker 均引用同一模块。

### P1. Provider test endpoint 与 adapter URL 构造重复，且缺少统一 timeout

涉及位置：

- `src/app/api/v1/models/providers/[id]/test/route.ts`
- `src/lib/llm/provider-endpoints.ts`
- `src/lib/llm/adapter.ts`

现状：

- provider test route 内部又实现了一套 `normalizeBaseUrl()`、embedding probe URL 构造、context window 检测。
- adapter 已有 `normalizeProviderBaseUrl()`、`buildEmbeddingsUrl()`、`buildModelsUrl()`。
- test route 中多个 `fetch()` 没有统一 timeout。

影响：

- provider URL 规则容易漂移。
- 某些 provider 卡住时会拖慢 API 请求。
- 维度探测、模型列表、context window 检测难以单元测试。

优化设计：

- 把 provider 探测逻辑拆成 `src/lib/llm/provider-probe.ts`。
- 复用 `provider-endpoints.ts` 的 URL builder。
- 所有外部 provider 请求使用统一 `fetchWithTimeout()`。
- route 只做 auth、取 provider、调用 probe、保存探测结果、返回 DTO。

### P1. 临时浏览器产物进入工作区并污染 lint 信号

涉及位置：

- `tmp-chrome-profile/`
- `tmp/dev-server-3001.*.log`
- `.gitignore`
- `eslint.config.mjs`

现状：

- 当前工作区存在 `tmp-chrome-profile/`，其中包含 Chrome profile、扩展脚本、缓存数据库等运行时产物。
- `pnpm lint` 会扫描到其中的大型 JS 文件，并产生大量与项目源码无关的 lint 输出。

影响：

- lint 结果被噪声淹没，难以判断真实源码问题。
- 运行时缓存、浏览器本地数据和潜在敏感信息不应进入版本管理视野。
- 后续优化阶段无法可靠使用 lint 作为回归信号。

优化设计：

- 将 `tmp-chrome-profile/`、`tmp/*.log`、浏览器运行 profile 和临时截图/导出产物加入 `.gitignore` 或 ESLint ignore。
- 确认这些目录下没有需要保留的源文件。
- 清理工作区中的临时产物后再建立 baseline lint。
- 不把临时产物清理混入业务重构 commit，应单独提交。

## 4. 中优先级架构问题

### P2. API route 仍承担过多业务逻辑

典型位置：

- `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts`
- `src/app/api/v1/drafts/[id]/sections/[secId]/compare/route.ts`
- `src/app/api/v1/drafts/[id]/sections/[secId]/assets/mermaid-generate-code/route.ts`
- `src/app/api/v1/models/providers/[id]/test/route.ts`

现状：

- route 中混合了 auth、参数解析、DB 查询、业务状态更新、LLM 调用、asset 创建、SSE 编码、日志和错误处理。

优化设计：

```text
route handler
  -> auth
  -> parse/validate input
  -> call service/use-case
  -> format response/SSE

service/use-case
  -> business rule
  -> DB mutation
  -> LLM/RAG/worker calls

lib helper
  -> stateless utility
```

建议优先拆：

- `generateSectionUseCase()`
- `compareSectionUseCase()`
- `generateDiagramCodeUseCase()`
- `probeProviderUseCase()`

拆分时不要改变 SSE 事件格式。

### P2. 写作生成流程中的副作用过密

涉及位置：

- `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts`
- `src/lib/writing/generator.ts`
- `src/lib/writing/diagram-generator.ts`
- `src/lib/writing/auditor.ts`

现状：

- SSE stream 中顺序执行：状态更新、RAG 引用保存、流式生成、asset request 解析、asset 创建、section 内容保存、asset 生成、marker 回填、token usage、后台 audit。

影响：

- 单个异常点会影响整条链路。
- 难以针对“引用已保存但内容失败”“内容成功但 asset 失败”“客户端断开但服务端继续写 DB”等情况做精确恢复。

优化设计：

- 把生成流程定义为显式阶段：

```text
prepareGeneration()
persistReferences()
streamModelContent()
finalizeGeneratedContent()
createAssetRequests()
generateReadyAssets()
placeAssetMarkers()
recordUsageBestEffort()
enqueueAuditBestEffort()
```

- 每个阶段明确失败是否阻塞。
- SSE route 只负责把阶段结果编码成事件。
- asset/audit 失败保持 non-blocking，但记录在可查询状态里，而不是只写 console。

### P2. 前端大页面和大组件仍有维护压力

典型位置：

- `src/app/(dashboard)/writing/[id]/page.tsx`
- `src/components/models/models-tabs.tsx`
- `src/app/(dashboard)/brainstorm/page.tsx`
- `src/app/(dashboard)/library/page.tsx`

现状：

- `writing/[id]/page.tsx` 同时负责 draft 加载、task 轮询、SSE parsing、导出、模型选择、panel resizing、asset 刷新。
- `models-tabs.tsx` 同时负责 provider CRUD、测试、默认模型、usage analytics、图表展示。

优化设计：

- 写作页先抽 hook，不急着重写 UI：

```text
useDraftDetail()
useSectionGeneration()
useGenerateAllTask()
useWritingModels()
useSectionAssets()
useResizablePanels()
```

- 模型页按 tab 拆：

```text
ModelListTab
EmbeddingModelsTab
ImageModelsTab
UsageAnalyticsTab
ProviderProbeResult
```

- 每次只抽一个 hook 或组件，并保持 props 与返回数据形状稳定。

### P2. Python worker 与 TypeScript 仍有部分规则重复

涉及位置：

- `workers/python/rag_index.py`
- `workers/python/rag_query.py`
- `workers/python/rag_manage.py`
- `src/lib/rag/dimension.ts`
- `src/lib/rag/context.ts`

现状：

- embedding dimension fallback 在 TS 和 Python 中都存在启发式判断。
- Python worker 仍需要消费 provider/base/model/key 参数。

优化设计：

- Node 侧尽量成为配置事实来源，Python 只消费显式参数。
- `--embed-dim`、`--embeddings-file` 优先级保持明确。
- Python fallback 只作为最后兜底，并在注释中说明“不得作为主逻辑”。
- 为 Node/Python 参数协议补一份小文档或测试 fixture。

### P2. 队列启动和并发语义需要更明确

涉及位置：

- `src/lib/queue/queue.ts`
- `src/instrumentation.ts`

现状：

- `TaskQueue.processNext()` 每次只取一个 pending task。
- `concurrency` 限制存在，但启动时并不会主动填满并发槽；依赖多次 submit 或任务完成后的递归调用。
- cancel 只是更新 DB 状态，无法真正中止正在进行的 LLM/Python 调用。

优化设计：

- 新增 `drain()` 或 `processAvailableSlots()`，一次填满空闲并发槽。
- 文档中明确 cancel 语义：当前是 cooperative cancel，只能阻止后续阶段或完成后忽略结果。
- 长任务逐步引入 `AbortSignal` 或阶段间 cancellation check。

## 5. 可读性与简洁性问题

### 5.1 `any` 和宽泛 `unknown` 应继续收敛

典型位置：

- `src/app/(dashboard)/writing/[id]/page.tsx`
- `src/components/writing/editor-panel.tsx`
- `src/components/writing/constraints-bar.tsx`
- `src/app/api/v1/drafts/[id]/outline/route.ts`
- `src/app/api/v1/drafts/[id]/sections/[secId]/assets/mermaid-generate-code/route.ts`

优化设计：

- API 返回 DTO 单独定义类型，不直接复用 Prisma 模型。
- 对 route body 用 Zod schema。
- 对 LLM JSON 输出先解析成 `unknown`，再用 schema 校验。

### 5.2 console 日志需要分级与脱敏

典型位置：

- `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts`
- `src/app/api/v1/drafts/[id]/sections/[secId]/assets/mermaid/route.ts`
- `src/app/api/v1/drafts/[id]/sections/[secId]/assets/mermaid-generate-code/route.ts`
- `src/components/writing/reference-panel.tsx`

现状：

- 日志中可能包含 prompt、生成结果片段、Mermaid/diagram JSON。

优化设计：

- 新增轻量 logger：

```text
src/lib/logger.ts
  debug/info/warn/error
  redact()
  enabled by LOG_LEVEL
```

- 默认生产环境不输出 prompt/content。
- 错误日志保留 request/task/section id 和错误摘要。

### 5.3 DTO mapper 能减少重复和安全风险

建议新增：

```text
src/lib/api/dto/
  providers.ts
  drafts.ts
  documents.ts
  tasks.ts
```

优先级最高的是 providers，因为它涉及密钥字段。

## 6. 推荐优化顺序

### Phase 0：保护网，不改变行为

目标：先让后续优化有回归依据。

建议新增/调整测试：

- providers API 不返回 `apiKey`。
- provider 编辑留空 key 时保留旧 key。
- provider 创建/编辑保存 `embeddingDim`。
- `deriveDraftStatus()`、`isSectionDone()` 覆盖所有状态。
- provider endpoint normalization 覆盖 `/v1`、`/v1/chat/completions`、`/v1/embeddings`。
- SSE parser 对 `references/chunk/reasoning/assets/done/error` 兼容。

### Phase 1：修复安全与状态一致性

目标：低改动、高收益。

建议顺序：

1. Provider DTO 去掉 `apiKey`。
2. ProviderForm 编辑态不回填 key。
3. POST/PUT 持久化 `embeddingDim`。
4. JWT helper 统一配置。
5. 状态类型、label、文档、测试统一。

### Phase 2：统一 Provider/LLM/RAG 边界

目标：减少重复逻辑。

建议顺序：

1. 抽 `provider-probe.ts`。
2. provider test route 复用 `provider-endpoints.ts`。
3. 所有 provider fetch 使用 timeout。
4. RAG Python 参数协议整理。
5. `createRagContext()` 扩展 user/provider 边界。

### Phase 3：写作生成 service 化

目标：控制复杂度，不改 SSE 协议。

建议顺序：

1. 抽纯函数：SSE event builder、reference persistence mapper、asset marker placement。
2. 抽副作用阶段：reference 保存、asset request 创建、usage 记录。
3. 最后将 route 中 orchestration 收敛成 use-case。

### Phase 4：前端拆分

目标：降低页面维护成本。

建议顺序：

1. `writing/[id]/page.tsx` 抽 hooks。
2. `models-tabs.tsx` 按 tab 拆组件。
3. `brainstorm/page.tsx` 抽 session/message/outline hooks。
4. 逐步统一 `useFetchJson()` 和 `usePolling()` 使用。

### Phase 5：性能与并发

目标：只优化明确热点。

建议点：

- `TopologyCanvas` 当前仍通过 `requestAnimationFrame -> setTick()` 触发 React 每帧渲染，可改为 CSS transform/ref 局部更新。
- 文档 embedding 已有 bounded batch，但 DB 写入和文件写入继续保持小并发。
- Provider probe 可 bounded concurrency，但 SQLite 写入仍顺序或小事务。
- 长任务 cancellation 逐步支持阶段间检查。

## 7. 不建议短期做的事情

- 不建议一次性大规模重写 `writing/[id]/page.tsx`。
- 不建议改 API envelope。
- 不建议改 SSE event 协议。
- 不建议改 chunk 文件命名或 LightRAG chunk id。
- 不建议引入 React Query/SWR，除非先证明现有 hooks 不能满足。
- 不建议把 SQLite 写入并发调得很高。
- 不建议在未补测试前改写 section 状态机。
- 不建议把 Python worker 和 Node 侧同时大改。
- 不建议把 UI 组件抽象成过早通用的大型框架。

## 8. 验证矩阵

每个阶段至少运行：

```bash
pnpm test:run
pnpm lint
pnpm build
```

涉及 UI 时手动验证：

- setup / login / refresh token
- 添加 provider，编辑 provider 不破坏 key
- provider test 能更新 context window 和 embedding dim
- 上传文档到 ready
- keyword search
- semantic search
- LightRAG 不可用时 fallback
- brainstorm session 创建、消息、outline
- draft 创建和详情加载
- 单章节 SSE 生成
- RAG references 展示和保存
- A/B compare
- confirm / unlock / regenerate
- full draft generation task
- diagram/image asset marker 渲染
- export markdown/pdf/docx

## 9. 建议最终边界

```text
src/app/api/v1/*
  只做 auth、validate、调用 use-case、返回 response

src/lib/api
  response helpers、DTO mappers、route body schemas

src/lib/auth
  token-core、session、password

src/lib/llm
  adapter、provider endpoints、provider probe、capabilities、model resolution

src/lib/rag
  context builder、dimension、LightRAG bridge、manage action types

src/lib/documents
  converter、splitter、pipeline stages、storage、embedding persistence

src/lib/writing
  status、context assembly、generation use-cases、audit、humanize、assets

src/lib/queue
  queue orchestration、worker registration、cooperative cancellation

src/components/<feature>
  feature UI

src/hooks
  feature hooks and small shared fetch/polling hooks
```

## 10. 第一轮最小落地建议

如果只做一轮，建议只做以下几项：

1. 修 provider API key 返回和二次加密问题。
2. 保存 `embeddingDim`。
3. 统一 JWT 配置。
4. 统一 writing status 类型、label、测试、文档。
5. 抽 provider probe helper，复用 URL builder。
6. 给 section generation SSE 增加协议测试。

这组改动对功能提升不花哨，但能明显降低后续继续开发时破坏已完成功能的概率。
