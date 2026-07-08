# Synthetix 代码优化设计实施方案 v1.1.0

> 审核日期：2026-07-06  
> 审核范围：`src/`、`workers/python/`、`electron/`、`scripts/`、`docs/code-optimization-design-v1.0.0.md` 及历史优化文档  
> 产出目标：先形成 Markdown 优化设计实施方案，不修改业务代码。后续每一批实施都必须保持当前功能逻辑、用户可见行为和数据契约不变。

---

## 0. 本方案的使用方式

本文件不是“一次性重写授权”，而是后续 AI 或工程师按批次执行的优化路线图。

实施时必须遵守：

- 只做行为等价的提取、集中、补测试、补文档；不借优化名义改变产品需求。
- 每个优化项先补或确认测试，再改代码。
- 每个批次都能独立回滚。
- 不删除当前 API route、fallback、兼容路径、旧字段处理或 best-effort 副作用，除非另写废弃方案并得到确认。
- 不修改数据库 schema、SSE 协议、API envelope、asset marker、LightRAG chunk id、状态机，除非单独设计迁移和兼容方案。

当前工作区已有用户改动：

```text
M  README.md
?? README.new.md
?? docs/code-optimization-design-v1.0.0.md
```

后续执行不得覆盖这些改动。

---

## 1. 分析方法：每个优化两轮以上复核

每个进入本方案的优化都经过至少两轮分析：

| 轮次 | 检查内容 | 目的 |
| --- | --- | --- |
| 第一轮：代码本体 | 直接读相关 module 的 interface 和 implementation | 判断是否真的存在重复、浅 module、接口泄漏或维护摩擦 |
| 第二轮：上下文反证 | 查调用方、测试、文档、旧方案和功能契约 | 排除“看起来能改但会改变行为”的优化 |
| 第三轮：过期项校正 | 对比 `code-optimization-design-v1.0.0.md`、历史优化文档和当前代码 | 避免重复提出已完成或已降级的建议 |

本轮明确修正了旧文档中的部分建议：

- `resolveModel(capability, userId?)` 当前已经按 `userId` 过滤，并有短 TTL cache；不再把“模型解析按 userId 收敛”列为待做主项。
- Provider PUT schema 已使用 `providerUpdateSchema`，Provider DTO 已通过 `toProviderDto()` 和 `ModelConfigDto` 避免直出 API key；不再重复列为待做主项。
- “前端没调用的 route”不能等同死代码；本方案不建议删除 API surface。
- `diagram-renderer.ts` 虽长，但应先补测试，暂不建议直接拆文件。

---

## 2. 总体判断

当前代码不是无结构的“屎山”。项目已经有清晰的 domain module：

```text
src/app/api/v1           route handler、SSE、REST 入口
src/lib/documents        文档生命周期、转换、切分、embedding、indexing
src/lib/llm              provider adapter、模型解析、usage、限流
src/lib/rag              RAG context、LightRAG 参数桥接
src/lib/wiki             Wiki 合成、查询、写回
src/lib/writing          写作上下文、生成、asset、export、audit
src/lib/queue            in-process task queue 和 worker orchestration
src/components/hooks     前端页面、工作流 hooks、UI module
workers/python           转换、chunk、RAG、export worker
```

真正影响 AI 后续维护、新功能增加和 bug 修复的是这些工程摩擦：

- route handler 重复 auth、params、draft/section ownership 查询，route interface 偏宽。
- `generator.ts` 中生成上下文准备逻辑在 full、stream、compare 路径重复，AI 修改时容易漏改一路。
- asset marker 解析已经有 `marker-parser.ts`，但 `confirm-asset` route 仍手写另一套正则和字段保留逻辑。
- SSE event、marker、persisted JSON、AsyncTask JSON 等协议缺少足够的窄测试面。
- `JSON.parse`、`process.env`、`console.*` 分散，错误模式和脱敏策略不够集中。
- 前端仍有页面级大 module，如 `search/page.tsx`、`reference-panel.tsx`、`editor-panel.tsx`，维护时上下文负担高。

这些属于工程债和 module depth 不足，不是功能架构错误。优化策略应是“加护栏后小步深挖”，不是大规模重写。

---

## 3. 必须保持不变的功能契约

后续任何优化前都要逐项确认是否触碰：

| 契约 | 必须保持 |
| --- | --- |
| API envelope | `{ success, data?, error?, code? }` |
| Auth 行为 | 受保护 route 继续使用当前 cookie/JWT 语义 |
| Document status | `uploading`、`converting`、`splitting`、`embedding`、`indexing`、`ready`、`failed` |
| Section status | 保持 `src/lib/writing/status.ts` 的完成状态判断 |
| AsyncTask | `status/progress/resultData/inputData` 继续可被前端轮询解析 |
| SSE event | `references`、`reasoning`、`chunk`、`assets`、`done`、`error`、compare 的 `model_error` |
| Asset marker | `[DIAGRAM:<assetId>|id=<markerId>...]`、`[IMAGE:<assetId>|id=<markerId>...]`、request marker 兼容 |
| Chunk / LightRAG ID | `chunk_000.md`、`DocumentChunk.index`、`<docId>/chunk_XXX` 语义不变 |
| RAG fail-soft | Wiki/RAG/graph 失败不阻断主写作流程 |
| API key | 不返回前端、不写日志、只在服务端解密 |
| SQLite | 默认本地 SQLite，写入并发保持保守 |
| Node/Python worker contract | 参数名、返回 JSON shape、usage 回传保持兼容 |

---

## 4. 优化候选与两轮证据

### 4.1 P0：建立优化安全网，而不是先重构

**Files**

- Modify: `src/__tests__/writing/sse-events.test.ts`
- Modify: `src/__tests__/writing/marker-parser.test.ts`
- Modify: `src/__tests__/queue/task-json.test.ts`
- Modify: `src/__tests__/writing/asset-marker-confirmation.test.ts`

**第一轮代码证据**

- `src/lib/writing/sse-events.ts` 是 SSE 协议的唯一 helper，但当前只定义序列化函数，没有直接协议测试。
- `src/lib/writing/marker-parser.ts` 提供 `parseAllMarkers()`、`injectMarkerIds()`，但没有对应测试文件。
- `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts` 和 `compare/route.ts` 直接依赖 SSE event 名称。
- `src/hooks/writing/use-generation.ts` 直接按 `data.type` 分支解析 `references/reasoning/chunk/model_error/error/done`。

**第二轮上下文证据**

- README 和历史方案都把“section SSE generation、asset marker、references 展示和保存”列为核心功能。
- 旧方案多次建议先补 SSE、marker、JSON parser 测试，说明这是跨多轮审核都稳定存在的风险点。
- 当前已有 `once-recorder.test.ts`、`generator-rag-softfail.test.ts`、`generator-parallel.test.ts`，说明写作路径适合先加窄测试再重构。

**Solution**

先补协议测试，不改变 implementation。测试锁定当前行为，让后续 refactor 有回归信号。

**Implementation steps**

- [ ] 为 `sseEvent("chunk", { content: "x" })`、`sseDone()`、`sseError("x")` 增加精确字符串和 JSON parse 测试。
- [ ] 为 `parseAllMarkers()` 增加 request marker、confirmed marker、多行字段、pipe 字段、缺失 id 的测试。
- [ ] 为 `injectMarkerIds()` 增加“已有 id 不变”和“无 id 注入 id”的测试。
- [ ] 为 AsyncTask `inputData/resultData` 增加坏 JSON fallback 测试，先定义期望行为。
- [ ] 为 asset marker confirmation 增加纯函数级 fixture，覆盖 request marker 替换为 confirmed marker、保留字段、找不到 marker。

**Verification**

```bash
pnpm test:run src/__tests__/writing/sse-events.test.ts
pnpm test:run src/__tests__/writing/marker-parser.test.ts
pnpm test:run src/__tests__/queue/task-json.test.ts
```

**Risk**

无运行时风险。只加测试。

---

### 4.2 P1：深化 route 前置条件 module，减少 auth + ownership 样板

**Files**

- Modify: `src/lib/api-helpers.ts`
- Modify: `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts`
- Modify: `src/app/api/v1/drafts/[id]/sections/[secId]/compare/route.ts`
- Modify: `src/app/api/v1/drafts/[id]/sections/[secId]/assets/confirm-asset/route.ts`
- Test: `src/__tests__/api-helpers.test.ts`

**第一轮代码证据**

- 多个 draft section route 重复：
  - `getAuthUser()` + `authErrorResponse()`
  - `await params`
  - `db.draft.findFirst({ id, userId })`
  - `db.section.findFirst({ id: sectionId, draftId })`
- `generate/route.ts`、`compare/route.ts`、`assets/confirm-asset/route.ts` 都有同类 ownership 检查，但后续业务逻辑不同。

**第二轮上下文证据**

- `src/lib/api-helpers.ts` 目前只有 response helper，说明 route 前置条件还没有形成深 module。
- `docs/code-optimization-design-v1.0.0.md` 和历史路线图都把 route 样板重复列为 AI 维护风险。
- 这些 route 的核心业务逻辑不应该变化；只把相同前置条件集中，能提高 locality。

**Solution**

在 `api-helpers.ts` 或新建 `src/lib/api/route-context.ts` 增加窄 helper，只处理可完全等价的 auth、params、owned draft、section lookup。

**Target interfaces**

```ts
export async function requireAuthUser(): Promise<{ user: AuthUser } | Response>;

export async function loadOwnedDraft(
  draftId: string,
  userId: string,
): Promise<Draft | Response>;

export async function loadSectionInDraft(
  sectionId: string,
  draftId: string,
): Promise<Section | Response>;
```

**Implementation steps**

- [ ] 先为 `requireAuthUser()` 写未登录返回 401 的测试。
- [ ] 写 `loadOwnedDraft()` 找不到 draft 返回 `draftNotFound` 的测试。
- [ ] 写 `loadSectionInDraft()` 找不到 section 返回 `sectionNotFound` 的测试。
- [ ] 只迁移 `confirm-asset/route.ts` 作为试点。
- [ ] 跑 confirm asset route 相关测试和 `tsc`。
- [ ] 再迁移 `generate/route.ts` 与 `compare/route.ts`。

**Behavior constraints**

- HTTP status 不变。
- error code 不变。
- 查询条件不变。
- route 中业务顺序不变。

**Verification**

```bash
pnpm test:run src/__tests__/api-helpers.test.ts
pnpm test:run src/__tests__/writing/asset-marker-confirmation.test.ts
pnpm exec tsc --noEmit
```

**Risk**

低。纯提取，但必须逐 route 迁移，不能批量机械替换全项目。

---

### 4.3 P1：深化 writing generation context module，消除 full/stream/compare 漂移

**Files**

- Modify: `src/lib/writing/generator.ts`
- Test: `src/__tests__/writing/generator-parallel.test.ts`
- Test: `src/__tests__/writing/generator-rag-softfail.test.ts`
- Add: `src/__tests__/writing/generator-context.test.ts`

**第一轮代码证据**

- `generateSectionFull()` 和 `generateSectionStream()` 都执行：
  - custom model 或 default writing model 解析
  - `enrichSectionContext()`
  - `fetchWikiContext()`
  - `fetchRagReferences()`
  - wiki refs + rag refs 合并
  - `buildEffectiveConstraints()`
  - `assembleContext()`
- `compareSectionStream()` 也有相同的 enrichment/wiki/rag/context assembly，但使用两个 provider stream。

**第二轮上下文证据**

- `generate/route.ts` 和 `draft-worker.ts` 分别调用 stream/full；如果只改一路，会造成 UI 单节生成和后台 generate-all 行为漂移。
- 当前已有 `generator-parallel.test.ts` 专门保护 pre-stream 并发，已有 `generator-rag-softfail.test.ts` 保护 RAG fail-soft。
- README 把“section by section writing、generate-all、A/B compare、references preserved”列为核心工作流，所以此项必须先补测试再提取。

**Solution**

提取内部 deep module：`prepareGenerationContext()`。外部 exported interface 不变。

**Target internal interface**

```ts
interface PreparedGenerationContext {
  provider: ReturnType<typeof createLLMProvider>;
  modelId: string;
  modelConfigId: string;
  messages: ReturnType<typeof assembleContext>;
  ragReferences: ContextInput["ragReferences"];
  wikiEntries: NonNullable<ContextInput["wikiEntries"]>;
  wikiEntryIds: string[];
}
```

**Implementation steps**

- [ ] 写 `generator-context.test.ts`，mock enrichment、wiki、semanticSearch，确认 refs 顺序仍是 Wiki 在前、RAG 在后。
- [ ] 测试 `ragMode: "off"` 不调用 `semanticSearch()`。
- [ ] 测试 custom model id 和 default model 两条路径都返回相同 `modelConfigId`。
- [ ] 提取 `resolveGenerationProvider()` 内部函数。
- [ ] 提取 `buildGenerationMessages()` 内部函数。
- [ ] 用 `prepareGenerationContext()` 改造 `generateSectionFull()`。
- [ ] 用同一 helper 改造 `generateSectionStream()`。
- [ ] 最后评估 `compareSectionStream()` 可复用的部分，避免一次改太多。

**Behavior constraints**

- 不改 exported function name、参数、返回值。
- 不改 RAG/Wiki fail-soft。
- 不改 token usage 记录时机。
- 不改 SSE route。

**Verification**

```bash
pnpm test:run src/__tests__/writing/generator-parallel.test.ts
pnpm test:run src/__tests__/writing/generator-rag-softfail.test.ts
pnpm test:run src/__tests__/writing/generator-context.test.ts
pnpm exec tsc --noEmit
```

**Risk**

中。核心写作路径。必须小步提交，先 full/stream，compare 另批。

---

### 4.4 P1：统一 asset marker replacement，消除 route 内第二套 marker parser

**Files**

- Modify: `src/lib/writing/marker-parser.ts`
- Modify: `src/app/api/v1/drafts/[id]/sections/[secId]/assets/confirm-asset/route.ts`
- Test: `src/__tests__/writing/marker-parser.test.ts`
- Test: `src/__tests__/writing/asset-marker-confirmation.test.ts`

**第一轮代码证据**

- `marker-parser.ts` 已经能解析 `[IMAGE_REQUEST]`、`[DIAGRAM_REQUEST]`、`[IMAGE]`、`[DIAGRAM]`。
- `confirm-asset/route.ts` 又手写：
  - `extractMarkerFields()`
  - request marker 正则
  - asset marker 正则
  - preserved fields 拼接
  - replacement 字符串构造
- 两套 implementation 容易在 marker 语法扩展时漂移。

**第二轮上下文证据**

- `asset-pipeline.ts` 已经使用 `injectMarkerIds()`，说明 marker-parser 是自然 seam。
- `export-pipeline.ts`、前端 `ReferencePanel`、`use-section-actions.ts` 都依赖 marker 保持稳定。
- 旧文档多次强调 asset marker 是核心契约，不能改格式，只能集中相同行为。

**Solution**

把 marker replacement 变成 `marker-parser.ts` 的深 module，route 只做 auth、load、调用、保存。

**Target interface**

```ts
export function replaceMarkerWithAsset(
  content: string,
  input: {
    markerId: string;
    assetId: string;
    assetType: string;
  },
): { ok: true; content: string } | { ok: false; reason: "not_found" | "unchanged" };
```

**Implementation steps**

- [ ] 先测试现有 route 支持的 request marker 多行字段。
- [ ] 测试已确认 marker 二次替换仍保留 `id` 之外字段。
- [ ] 在 `marker-parser.ts` 添加 `replaceMarkerWithAsset()`。
- [ ] `confirm-asset/route.ts` 删除本地 `extractMarkerFields()` 和正则，调用新函数。
- [ ] route 返回 status 和 error message 保持当前语义。

**Behavior constraints**

- Replacement 格式不变。
- `IMAGE` vs `DIAGRAM` 判断保持当前 asset type 逻辑。
- 找不到 marker 仍返回 404。

**Verification**

```bash
pnpm test:run src/__tests__/writing/marker-parser.test.ts
pnpm test:run src/__tests__/writing/asset-marker-confirmation.test.ts
pnpm exec tsc --noEmit
```

**Risk**

低到中。行为小但影响用户确认图片/图表资产，必须有 fixture 覆盖。

---

### 4.5 P2：集中 persisted JSON parsing，先覆盖高风险字段

**Files**

- Add: `src/lib/queue/task-json.ts`
- Add: `src/lib/writing/asset-metadata.ts`
- Add: `src/lib/wiki/source-refs.ts`
- Modify: `src/lib/queue/queue.ts`
- Modify: `src/app/api/v1/tasks/route.ts`
- Modify: `src/app/api/v1/tasks/[id]/route.ts`
- Modify: `src/lib/writing/diagram-generator.ts`
- Modify: `src/lib/writing/image-generator.ts`
- Modify: `src/lib/wiki/query.ts`
- Test: `src/__tests__/queue/task-json.test.ts`
- Test: `src/__tests__/writing/asset-metadata.test.ts`
- Test: `src/__tests__/wiki/source-refs.test.ts`

**第一轮代码证据**

- `JSON.parse` 分散在 AsyncTask、SectionAsset metadata、Wiki sourceRefs、Section constraints、LLM output、Python stdout parsing 等多类场景。
- `tasks/route.ts`、`tasks/[id]/route.ts`、`queue.ts` 都需要解析 task JSON。
- `diagram-generator.ts` 和 `image-generator.ts` 都在 merge metadata 时直接 `JSON.parse(asset.metadata)`。

**第二轮上下文证据**

- 并非所有 `JSON.parse` 都能统一替换：LLM output、Python protocol、DB metadata 的错误策略不同。
- 旧方案也明确“不一次性全局机械替换”，优先 task、asset metadata、SSE parser。
- 当前 `constraints.ts` 已有 `parseSectionConstraints()`，说明项目接受按领域定义 parser。

**Solution**

按领域建立小 parser，不做全局 `safeJsonParse` 大锤。

**Target interfaces**

```ts
export function parseTaskInput<T>(raw: string | null | undefined, fallback: T): T;
export function parseTaskResult<T>(raw: string | null | undefined, fallback: T): T;

export function parseAssetMetadata(raw: string | null | undefined): Record<string, unknown>;
export function mergeAssetMetadata(raw: string | null | undefined, patch: Record<string, unknown>): string;

export function parseWikiSourceRefs(raw: string | null | undefined): Array<{ documentId?: string }>;
```

**Implementation steps**

- [ ] 先为坏 JSON、空字符串、合法 JSON 写测试。
- [ ] 先迁移 `queue.ts` 和 task routes。
- [ ] 再迁移 asset metadata merge。
- [ ] 最后迁移 Wiki sourceRefs 高频路径。
- [ ] 不触碰 LLM output parser 和 Python protocol parser，除非单独补测试。

**Behavior constraints**

- 坏 JSON fallback，不让 route 500。
- 合法 JSON 输出 shape 不变。
- 不改变数据库字段存储格式。

**Verification**

```bash
pnpm test:run src/__tests__/queue/task-json.test.ts
pnpm test:run src/__tests__/writing/asset-metadata.test.ts
pnpm test:run src/__tests__/wiki/source-refs.test.ts
pnpm test:run src/__tests__/tasks/tasks-route.test.ts
pnpm exec tsc --noEmit
```

**Risk**

低。按字段迁移，不做全局替换。

---

### 4.6 P2：统一小工具 module，但保持不同语义

**Files**

- Add: `src/lib/concurrency/bounded.ts`
- Add: `src/lib/llm/http.ts`
- Add: `src/lib/text/tokens.ts`
- Modify: `src/lib/documents/pipeline.ts`
- Modify: `src/lib/wiki/synthesizer.ts`
- Modify: `src/lib/llm/adapter.ts`
- Modify: `src/lib/llm/anthropic-adapter.ts`
- Modify: `src/lib/llm/provider-probe.ts`
- Test: existing related tests

**第一轮代码证据**

- `documents/pipeline.ts` 有 `boundedAll()`。
- `wiki/synthesizer.ts` 有 `runBounded()`，功能相近但多 index 参数。
- `llm/adapter.ts` 与 `anthropic-adapter.ts` 都有 `fetchWithTimeout()` 和 `estimateTokens()`。
- `provider-probe.ts` 也有 `fetchWithTimeout()`，但默认超时与生产请求不同。

**第二轮上下文证据**

- 旧文档已指出这些工具函数重复，但也标记了 `fetchWithTimeout`、`truncateToTokens` 等语义不同，不能强行合并。
- 当前 LLM adapter 有专门 timeout 测试，说明 timeout 行为是契约。
- Pipeline 和 Wiki bounded concurrency 影响外部请求并发，不能改变默认 concurrency。

**Solution**

提取公共 primitive，但保留调用方默认参数。

**Target interfaces**

```ts
export async function mapBounded<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]>;

export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response>;

export function estimateTokens(text: string): number;
```

**Implementation steps**

- [ ] 为 `mapBounded()` 写顺序、并发上限、index 参数测试。
- [ ] 用 `mapBounded()` 替换 `runBounded()`，保持 Wiki `WIKI_EXTRACT_CONCURRENCY` 不变。
- [ ] 用 `mapBounded()` 替换 `boundedAll()`，保持 pipeline concurrency 参数不变。
- [ ] 提取 `fetchWithTimeout()`，adapter 继续传生产 timeout，probe 继续传探测 timeout。
- [ ] 提取 `estimateTokens()`，保持当前算法不变。

**Behavior constraints**

- 不改变并发数。
- 不改变 timeout 默认值。
- 不改变 token 估算算法。

**Verification**

```bash
pnpm test:run src/__tests__/llm/adapter-timeout.test.ts
pnpm test:run src/__tests__/llm/adapter-stream-timer.test.ts
pnpm test:run src/__tests__/documents/pipeline-stages.test.ts
pnpm test:run src/__tests__/wiki/okf-export.test.ts
pnpm exec tsc --noEmit
```

**Risk**

低到中。primitive 简单，但影响并发和 timeout，必须保持默认值。

---

### 4.7 P2：前端大 module 渐进拆分，只抽稳定 interface

**Files**

- Add: `src/hooks/writing/use-typewriter.ts`
- Modify: `src/components/writing/editor-panel.tsx`
- Add: `src/components/writing/reference-panel/asset-workspace.tsx`
- Add: `src/components/writing/reference-panel/rag-document-picker.tsx`
- Modify: `src/components/writing/reference-panel.tsx`
- Add: `src/hooks/search/use-search-results.ts`
- Add: `src/hooks/search/use-knowledge-graph.ts`
- Modify: `src/app/(dashboard)/search/page.tsx`

**第一轮代码证据**

- `editor-panel.tsx` 有三段 requestAnimationFrame 打字机逻辑，变量不同但 algorithm 相同。
- `reference-panel.tsx` 同时处理 RAG 文档选择、图片生成 SSE、Mermaid 生成、文件上传、asset preview。
- `search/page.tsx` 页面内直接管理 keyword/semantic search、knowledge graph loading、task polling、entity evidence、progress interpolation。

**第二轮上下文证据**

- 写作、搜索、知识图谱都是 README 中的核心功能，不能一次性重写。
- 项目已有 `hooks/writing/*` 和 `hooks/brainstorm/*` 范式，说明渐进抽 hook 符合当前风格。
- UI 拆分风险主要来自 props/state 丢失，所以应先抽纯展示和稳定 hook，不改文案、不改 API。

**Solution**

按最小可回归面拆分：

1. 先抽 `useTypewriter()`，行为完全一致。
2. 再拆 `ReferencePanel` 的 asset workspace 和 RAG picker。
3. 最后拆 search page hooks。

**Target interface**

```ts
export function useTypewriter(input: {
  active: boolean;
  target: string;
  easingDivisor?: number;
}): string;
```

**Implementation steps**

- [ ] 抽 `useTypewriter()`，保留 step 计算：`Math.max(1, Math.ceil((target.length - prev.length) / 8))`。
- [ ] `editor-panel.tsx` 三处调用 hook，不改 UI。
- [ ] `ReferencePanel` 先抽 `RagDocumentPicker`，只传 `sectionRagMode/selectedDocIds/onChange`。
- [ ] 再抽 `AssetWorkspace`，保留原 fetch URL、toast、SSE parsing。
- [ ] Search page 只在前两步稳定后再拆，不和 writing 改动同批。

**Behavior constraints**

- 不改 CSS class、文案、API URL。
- 不改 toast 文案。
- 不引入 React Query/SWR 或全局状态库。

**Verification**

```bash
pnpm lint
pnpm exec tsc --noEmit
```

手动验证：

```text
单章节生成打字机
A/B compare 双栏打字机
ReferencePanel 手动选择 RAG 文档
图片生成
Mermaid 生成
上传图片
确认 active marker
搜索 keyword / semantic
知识图谱加载和实体详情
```

**Risk**

中。UI 行为要手动验证，必须分批做。

---

### 4.8 P3：集中配置和日志，渐进替换高风险输出

**Files**

- Add: `src/lib/config.ts`
- Add: `src/lib/logger.ts`
- Modify: `src/lib/search/semantic.ts`
- Modify: `src/lib/wiki/synthesizer.ts`
- Modify: `src/lib/writing/generator.ts`
- Modify: `src/lib/documents/pipeline.ts`

**第一轮代码证据**

- `process.env` 分散在 auth、db、documents、llm、wiki、python、queue、settings routes。
- `console.warn/error/log` 分散在 LLM、RAG、Wiki、document pipeline、asset generation。
- 部分日志输出 error stack、line slice、query 或内容上下文，后续生产环境不易统一脱敏。

**第二轮上下文证据**

- `.env.example` 已经有大量配置项，README 也列出常用 env，说明配置本身是产品 interface。
- Python worker 和 LLM provider 错误排查依赖日志，不能简单删除日志。
- 旧方案也建议 logger 脱敏，但优先级低于协议测试和 route/generator 提取。

**Solution**

先新增 `logger.redact()` 和 `config` read helper，新代码使用；旧代码只替换高风险路径。

**Target interfaces**

```ts
export const config = {
  jwt: { accessExpires: string, refreshExpires: string },
  python: { path: string, threadLimit: number },
  rag: { graphTimeoutMs: number, basicTimeoutMs: number },
  wiki: { queryRewriteEnabled: boolean },
} as const;

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  redact(value: unknown): unknown;
};
```

**Implementation steps**

- [ ] 先为 `logger.redact()` 写 API key、Bearer token、长 content 截断测试。
- [ ] 新增 `config.ts`，只放已稳定 env，不一次迁移全部。
- [ ] 替换 `semantic.ts` 中打印 stack 的路径，保留 user/task/doc id。
- [ ] 替换 LLM SSE malformed line 日志，保留长度和摘要，不输出原文。
- [ ] 替换 Wiki/document pipeline 中可能输出内容的日志。

**Behavior constraints**

- 不吞掉错误。
- 不改变 fallback。
- 不改变 env 默认值。

**Verification**

```bash
pnpm test:run src/__tests__/logger.test.ts
pnpm exec tsc --noEmit
```

**Risk**

低。只改日志和配置读取，但要避免丢失排障信息。

---

## 5. 推荐实施批次

### Batch 0：恢复和记录基线

**Goal**

确认当前 lint/test/typecheck/build 能否作为后续回归信号。

**Steps**

- [ ] 运行 `pnpm lint`。
- [ ] 运行 `pnpm test:run`。
- [ ] 运行 `pnpm exec tsc --noEmit`。
- [ ] 运行 `pnpm build`。
- [ ] 如果 pnpm 因 ignored builds 阻塞，先单独处理 pnpm build approval，不混入业务优化。

**本轮观察**

本次尝试运行 `pnpm lint`、`pnpm test:run`、`pnpm exec tsc --noEmit` 均被 pnpm dependency build check 阻塞：

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: electron@33.4.11
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

因此后续第一步不是改业务代码，而是恢复可运行基线。

---

### Batch 1：协议测试保护网

执行 4.1。

通过标准：

- SSE helper 测试通过。
- marker parser 测试通过。
- task JSON 测试通过。
- 无业务代码行为变化。

---

### Batch 2：asset marker replacement 集中

执行 4.4。

通过标准：

- `confirm-asset` route 行为不变。
- request marker 和 confirmed marker 都能替换。
- 字段保留规则有测试。

---

### Batch 3：route 前置条件 module

执行 4.2，只先迁 3 个写作相关 route。

通过标准：

- auth、draft not found、section not found 行为不变。
- route 主体更聚焦业务流程。

---

### Batch 4：generation context 提取

执行 4.3。

通过标准：

- full generation、stream generation、RAG soft-fail、Wiki refs 顺序保持。
- generate-all 和单节生成共享同一上下文准备路径。

---

### Batch 5：persisted JSON parser

执行 4.5。

通过标准：

- task route 坏 JSON 不 500。
- asset metadata 坏 JSON fallback。
- Wiki sourceRefs 坏 JSON fallback。
- 不全局机械替换。

---

### Batch 6：工具 primitive 集中

执行 4.6。

通过标准：

- 并发数不变。
- timeout 默认值不变。
- token 估算不变。

---

### Batch 7：前端拆分

执行 4.7。

通过标准：

- 每次只拆一个页面区域。
- 页面功能手动验证通过。
- 不改 UI 文案和交互入口。

---

### Batch 8：配置和日志

执行 4.8。

通过标准：

- 高风险日志脱敏。
- env 默认值不变。
- fallback 仍记录可排障信息。

---

## 6. 不建议短期做的事情

- 不建议删除“前端未调用”的 API route。
- 不建议一次性重写 writing generation route。
- 不建议改 API envelope。
- 不建议改 SSE event 类型或字段。
- 不建议改 asset marker 格式。
- 不建议改 chunk id、chunk 文件名、FTS rowid 或 LightRAG id。
- 不建议在未补测试前拆 `diagram-renderer.ts`。
- 不建议大规模替换所有 `JSON.parse`。
- 不建议激进提高 SQLite 写并发。
- 不建议引入 React Query/SWR 或新的全局状态库。
- 不建议把 Node/Python worker 参数协议和业务 refactor 放在同一个批次。
- 不建议清理或覆盖用户当前未提交文档改动。

---

## 7. 每批实施前检查清单

```text
是否改变 API response shape？
是否改变 auth/cookie/JWT 行为？
是否改变 Document.status / Section.status / AsyncTask.status？
是否改变 SSE event 类型或字段？
是否改变 asset marker 格式？
是否改变 chunk index、chunk 文件名、LightRAG chunk id？
是否影响 FTS rowid 对齐？
是否可能向前端或日志泄露 API key / prompt / 文档原文 / 生成内容？
是否涉及 SQLite 写入并发？
是否新增裸 JSON.parse？
是否把 Prisma model 直接返回前端？
是否删除 fallback、兼容路径或 best-effort 副作用？
是否改变 Node/Python worker 参数名、默认值或返回 JSON shape？
是否会影响已生成 draft、section、asset、document 的读取？
```

任一项为“是”，必须先补测试或单独写设计。

---

## 8. 最低验证矩阵

每批至少：

```bash
pnpm lint
pnpm test:run
pnpm exec tsc --noEmit
pnpm build
```

涉及写作：

```text
单章节 SSE 生成
references 展示和保存
RAG fail-soft
Wiki writeback fail-soft
A/B compare
confirm / unlock / regenerate
generate-all task
asset marker 渲染和确认
export markdown/pdf/docx
```

涉及文档/RAG：

```text
文档上传到 ready
keyword search
semantic search
LightRAG 不可用时 fallback
graph mode 降级 basic
wiki synthesize
entity evidence
```

涉及前端：

```text
setup / login / refresh
provider 新增、编辑、测试
brainstorm session、message、outline
library 搜索和文档详情
search 页面 keyword / semantic / knowledge graph
settings 页面
```

---

## 9. Top recommendation

第一优先级不是马上重构，而是执行：

```text
Batch 0：恢复和记录基线
Batch 1：协议测试保护网
Batch 2：asset marker replacement 集中
```

理由：

- 当前 pnpm build-script approval 阻塞验证命令，必须先恢复工程信号。
- SSE、marker、JSON parser 是后续所有写作重构的测试表面。
- `confirm-asset` route 与 `marker-parser.ts` 的重复是真实浅 module 问题，集中后能提升 locality，且不会改变功能需求。

完成这三批后，再做 route helper 和 generator context 提取，风险最低。
