# Synthetix 代码审核与优化方案

> 审核日期：2026-06-23
> 二次复核：2026-06-23（修正了 P1/P3 分级，补充遗漏项，记录已执行项）
> 审核范围：`src/` 手写代码（约 5.0 万行，排除 `src/generated/prisma/` 生成的 3.5 万行）
> 审核分支：`chore/windows-installer-v0.10.9`
> 审核方法：分三区（lib / app / components）并行探索 + 关键发现交叉验证（读源码确认）+ 第二轮独立复核

---

## ⚠️ 二次复核重要修正（2026-06-23）

第二轮独立复核发现：**"前端未调用的 API route"不等于"死代码"**。本项目是自托管产品，部分 route 是 CLI/API 契约（见 `docs/cli-design.md`）、计划功能入口（见 README 的 version/rollback 宣传）、或测试保护的能力。因此：

- **原 P1 "删除 19 个死 API 路由"已降级为 P3**（API surface 审计），未经逐条确认不得删除。
- 原 `auth/refresh`、`rollback`/`versions`、`knowledge/*`、`wiki/synthesize` 等 route **不再列为"可安全删除"**。
- 所有"风险无"措辞已改为更保守的"代码调用风险低，需测试验证"。

详见第 4 节（P3）的 API surface 分级表。

---

## 0. 执行摘要

代码库整体质量**中上**：0 个 TODO/FIXME、0 处 `@ts-*` 抑制、0 处未使用 `any` 滥用，说明开发者有较好的纪律。但有明显的**屎山累积特征**：功能做了合并了但 UI 没接 / 被新实现取代后没删、同样的工具函数在多处各自实现、两套风格并存（hook 范式 vs 内联 fetch）。

**最严重的问题**是 `startup.ts` 里一段"按文件大小覆盖数据库"的逻辑，存在**真实数据丢失风险**——这是历史遗留的一次性迁移代码，却每次启动都执行。（**已于 Phase 1 修复** ✅）

| 档位 | 含义 | 项数 | 状态 |
|---|---|---|---|
| 🟢 **Phase 0/1 安全执行** | baseline 修复 + 纯删死代码/类型，经 grep+源码+tsc+test 验证 | 已完成 9 项 | ✅ 已执行 |
| 🟡 **P2 建议执行** | 重构提升可维护性，需小范围回归测试但不改行为 | 14 | 待执行 |
| 🔴 **P3 需用户确认** | 涉及安全策略、外部契约或 API surface，需你拍板 | 8+ | 待决策 |

---

## 1. 量化基线

| 指标 | 数值 |
|---|---|
| 手写代码总量 | 49,992 行 / 455 文件 |
| 最大模块 | `src/lib/writing/` 5,260 行 |
| 最大文件 | `src/lib/writing/diagram-renderer.ts` 1,206 行 |
| 死 API 路由占比 | **约 22%（85 个 route 中 19 个无前端调用方）** |
| 代码异味 | 0 TODO / 0 ts-suppress / 2 `any` / 11 console（均在启动/缓存层，可接受） |
| 重复工具函数 | 6 组（`verifyToken`/`formatFileSize`/`fetchWithTimeout`/`estimateTokens`/`ensureDir`/`parseArray`） |

---

## 2. Phase 0 —— 工程基线（✅ 部分完成）

### 2.0.1 ✅ 修复 ESLint 扫描 `dist/` 打包产物

**问题**：`eslint.config.mjs` 的 `globalIgnores` 没有排除 `dist/`，导致 `npm run lint` 进入 `dist/.runtime-cache/python/.../patchright/.../*.js`（超大文件），命令被 BABEL deoptimize 拖到中断。lint 完全无法作为回归信号。

**修复**：在 `globalIgnores` 加 `dist/**`。

**验证**：`npm run lint` 从"命令中断"变为"能跑出 74 errors/22 warnings"的真实结果。

### 2.0.2 ⚠️ 当前 test baseline 存在 Prisma DB timeout flaky（未修复，需专项）

**现象**：`npm run test:run` 有 6-14 个测试（每次跑数量波动）失败，全部是 `PrismaClientKnownRequestError: Operation has timed out`，集中在 `db.user.upsert`。

**根因**：多个测试文件共享同一个 `dev.db`（`vitest.config.ts` 里 `DATABASE_URL: "file:./dev.db"`），SQLite 写锁竞争导致超时。这是既有问题，与代码质量无关。注意：**不要用 `--runInBand`**（这是 Jest 参数，Vitest 4 报 `Unknown option`）。

**建议专项**：测试使用独立临时 DB（`:memory:` 或 temp file），或限制 DB 集成测试文件串行执行。

### 2.0.3 ⚠️ lint 噪声：诊断脚本的 `no-require-imports`（低优先级）

74 个 lint error 中 60 个来自根目录诊断脚本（`inspect-*.cjs`、`poll-*.cjs` 等）和 `packaging/first-run.js` 的 `require`。这些脚本多被 `.gitignore` 忽略但 lint 仍扫。建议扩展 ignore 规则到 `**/*.cjs`、`packaging/**`。

---

## 3. Phase 1 —— 安全清理（✅ 已完成）

> 以下项已执行完毕，每项均通过 tsc + test 验证无新增失败。

### 3.1 ✅ [最高优先] 修复 startup.ts 的危险数据覆盖分支

**问题**：`src/lib/startup.ts` 有一段"一次性迁移"逻辑，但每次冷启动都执行：

```ts
} else if (fs.statSync(newDbPath).size < fs.statSync(oldDbPath).size) {
  fs.copyFileSync(oldDbPath, newDbPath);  // ← 用旧库覆盖新库
}
```

只要项目根残留一个较大的旧 `dev.db`，就静默覆盖用户最新数据（清表后库变小、migrate 后体积暂时变小、克隆带了开发库都会触发）。

**修复**：删除 size 比较覆盖分支，保留"目标库不存在时的首次迁移"（比"整体移除"更保守，兼容老用户首次升级）：

```ts
if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
  fs.copyFileSync(oldDbPath, newDbPath);
  console.log(`[db] migrated existing database to ${newDbPath}`);
}
```

同时消除 `dataDir` unused lint warning，代码内附注释说明为何删除覆盖分支。

**验证**：tsc 通过；test 无新增失败。

### 3.2 ✅ 删除 generator.ts 死函数（119 行）

三个零调用符号已删除：

| 符号 | 原行号 | 说明 |
|---|---|---|
| `generateSection` | 208-228 | 非流式旧版，仅转调 `generateSectionFull` 后丢字段 |
| `ComparisonResult` | 441-451 | 接口，无外部 import |
| `compareSection` | 453-539 | 非流式对比，已被 `compareSectionStream` 取代 |

活跃的流式版（`generateSectionFull` / `generateSectionStream` / `compareSectionStream`）全部保留。

**验证**：tsc 通过；writing 模块 53 测试全通过；`GenerationResult` 仍被 `FullGenerationResult` 继承（活跃）。

### 3.3 ✅ 删除死类型 & 死函数

| 文件 | 符号 | 处理 |
|---|---|---|
| `src/types/topology.ts` | `GraphViewMode` | 删除（grep 全树仅定义行） |
| `src/types/api.ts` | `PaginatedResponse<T>` | 删除（仅定义行；`ApiResponse` 保留，被 3 处引用） |
| `src/lib/api-helpers.ts` | `authOrError()` + 相关 imports | 删除（从未被任何 route 使用；连带删除 unused 的 `getAuthUser`、`AuthUser` import） |

### 3.4 ✅ 去掉多余 export（保留定义）

| 文件 | 符号 | 处理 |
|---|---|---|
| `src/types/writing.ts` | `SectionReferenceMeta` / `SectionVersionMeta` | 去 `export`（仅同文件内使用） |
| `src/types/documents.ts` | `TagMeta` / `DocumentImageMeta` | 去 `export`（仅同文件内使用） |

行为不变。

### 3.5 ✅ 同步 README 版本号

`README.md` 的 `Current version: v0.5.3.0` 改为指向 `package.json`，避免每次发版漏改。

---

> **原 2.3"删除 19 个死 API 路由"已降级为 P3**。前端未调用不等于可删——多条 route 在 `docs/cli-design.md`、`docs/requirements-analysis.md`、README 产品承诺中明确为 CLI/API 契约或计划功能。详见第 4 节 API surface 审计。
>
> **原 2.5 `splitter.ts` 多余 export**：本次未执行（`documentHasStructure`/`extractSectionTitles` 去 export 属低优先级，留待 P2 批次）。

---

## 3. P2 —— 建议执行（提升可维护性，需回归测试）

> 这些是重构，不改对外行为，但建议每项做完跑一遍相关功能的 `npm run test:run` + 手动验证。

### 3.1 统一 6 组重复工具函数到公共模块

| 重复组 | 现状 | 建议落点 |
|---|---|---|
| `formatFileSize` | `i18n/format.ts:47`（带 locale，支持 TB）与 `text/format-file-size.ts:1`（无 locale，无 TB）**行为不一致** | 保留 i18n 版作为主，text 版改为调用 i18n 版或删除；**注意调用方契约不同，需逐一核对** |
| `estimateTokens` | `documents/splitter.ts:15` 与 `llm/adapter.ts:30` **逐字相同**（`Math.max(1, Math.ceil(len/1.5))`） | 抽到 `src/lib/text/tokens.ts`，两处改 import |
| `truncateToTokens` | `auto-tagger.ts:21`（按行）与 `wiki/synthesizer.ts:329`（按字符+句号边界）**语义不同** | ⚠️ 不应强行合并。建议各自保留但在 `text/tokens.ts` 提供两个命名清晰的版本：`truncateByLines` / `truncateBySentences` |
| `ensureDir` | `diagram-generator.ts:10`、`image-generator.ts:11`、`storage.ts:33`（方法）三处逐字相同 | 抽到 `src/lib/utils.ts` 或 `fs-utils.ts` |
| `parseArray` | `wiki/synthesizer.ts:391` 与 `wiki/writer.ts:204` **逐字相同** | 抽到 `src/lib/wiki/json-utils.ts` |
| `isRecord` | `outline-normalizer.ts:9`、`diagram-parse.ts:7` 两处相同（`knowledge/health.ts` 那个是同名不同义，不动） | 抽到 `src/lib/utils.ts` |
| `fetchWithTimeout` | `llm/adapter.ts:24`（5分钟超时）与 `provider-probe.ts:5`（15秒超时）**超时差 20 倍** | ⚠️ 超时语义不同（生产请求 vs 探测）。建议抽到 `llm/http.ts` 但**保留两个超时参数预设**，不要强行统一 |

**重要**：`formatFileSize`、`truncateToTokens`、`fetchWithTimeout` 三组**行为不一致**，不能简单合并成一个，否则会改变运行时行为。方案里已分别处理。

**严重度**：🟡 中｜**风险**：低（纯重命名/移动，行为保持；3 组"行为不一致"的已标注特殊处理）

---

### 3.2 抽离 generator.ts 的重复模板（消除约 120 行重复）

`src/lib/writing/generator.ts` 有两处 copy-paste：

1. **`effectiveConstraints` 构造块**出现 **4 次**（`:290-302`、`:412-420`、`:483-491`、`:588-596`），逐字相同
2. **`customModelConfigId` provider 解析块**出现 **2 次**（`:242-262`、`:361-381`，各 20 行）

**修复**：抽两个 helper：
- `resolveProvider(customModelConfigId, userId)` 
- `buildEffectiveConstraintsWithEnrichment(baseConstraints, enrichment, retrievalQuery)`

四处/两处调用点改为调 helper。**对外函数签名不变**，仅内部去重。

**验证**：`npm run test:run`（generator 相关测试）+ 手动跑一次章节生成 + A/B 对比，确认输出一致。

**严重度**：🟡 中｜**风险**：低（行为不变，纯提取）

---

### 3.3 抽离 editor-panel.tsx 的打字机重复（消除约 60 行）

`src/components/writing/editor-panel.tsx:95-187` 有**三段几乎一字不差的打字机 useEffect**（单列、对比 A、对比 B），仅变量名不同（`displayedContent`/`displayContentA`/`displayContentB`）。

**修复**：抽 `useTypewriter(streaming: string, active: boolean)` hook，三处调用。

**验证**：手动在 writing 页跑单列生成 + A/B 对比生成，确认打字机动画一致。

**严重度**：🟡 中｜**风险**：低

---

### 3.4 拆分 reference-panel.tsx（733 行单文件 5 业务）

`src/components/writing/reference-panel.tsx` 单文件塞了 5 段互不相关业务：文档选择、图片生成 SSE、Mermaid 生成、文件上传、图片预览模态框。

**修复**：拆为
- `<ReferenceList>`（文档选择）
- `<AssetGenerator>`（图片/Mermaid 生成，逻辑抽到 `use-section-assets` hook）
- `<ImagePreviewModal>`（预览）

**严重度**：🟡 中｜**风险**：中（组件拆分需仔细迁移 props/state，做完必须手动验证整条写作参考面板流程）

---

### 3.5 修复 ErrorCode 类型被"假遵守"的洞

**问题**：`src/app/api/v1/wiki/entries/route.ts:98,102` 用了 `"invalidBody"`、`"missingIds"` 两个 **不在** `api-helpers.ts:6-26` 的 `ErrorCode` 联合类型里的值。因 line 69 用了 `error as {code: ErrorCode;...}` 断言掩盖，TS 不报错——前端 `getLocalizedError` 拿到未知 code 会回退到通用错误。

**修复**：把 line 69 的断言改为直接类型约束，让 TS 编译期抓住未知 code；然后补全枚举（加 `invalidBody`/`missingIds`）或改用已有 code。

**验证**：`tsc --noEmit` 应报错定位到这两行 → 修复后通过。

**严重度**：🟡 中｜**风险**：低（改类型，暴露的是既有 bug）

---

### 3.6 search/page.tsx 重构为 hook 范式

`src/app/(dashboard)/search/page.tsx`（584 行）是项目内**最严重的组件臃肿**：5 个内联 fetch、6+ useEffect、3 个 setInterval 轮询，零 hook 抽离（`src/hooks/` 下甚至没有 `search/` 目录）。而 `writing/[id]/page.tsx` 已建立了正确的 hook 范式（6 个 hook）可参照。

**修复**：新建 `src/hooks/search/` 目录，抽 `use-search-results`、`use-knowledge-graph`、`use-search-polling` 等，page 退化为编排层。

**严重度**：🟡 中-高｜**风险**：中（重构搜索页核心，需全面回归测试搜索+知识图谱功能）

---

### 3.7 统一手写 Spinner → shared/spinner.tsx

`shared/spinner.tsx` 已存在，但 `reference-panel.tsx:500,542,559,576`、`models-tabs.tsx`、`topology-detail-panel.tsx` 仍各自手写 `<div className="... animate-spin" />`。

**修复**：统一改用 `<Spinner size="sm" />`。纯视觉，行为不变。

**严重度**：🟡 低-中｜**风险**：无

---

### 3.8 统一两套 markdown 渲染器

`shared/markdown-renderer.tsx`（27 行极简版，识别 bold+列表）与 `writing/markdown-renderer.tsx`（240 行完整版）并存，功能是子集关系。

**修复**：废弃 shared 版，统一用 writing 版（或把 writing 版提升到 shared）。

**验证**：检查 brainstorm/page、wiki/[id]/page 用 shared 版渲染的内容，迁移后显示正常。

**严重度**：🟡 低-中｜**风险**：低-中（渲染样式可能有细微差异，需视觉核对）

---

## 4. P3 —— 需用户确认（API surface / 安全策略）

> ⚠️ 二次复核修正：原 P1 "删除 19 个死 API 路由"全部移到此处。前端未调用不等于可删。

### 4.1 API surface 审计（原"删除 19 个死 route"）

以下 route 前端零调用，但**不能直接删除**。需结合 `docs/cli-design.md`、`docs/requirements-analysis.md`、测试引用、README 产品承诺逐条决策。

**A 类：CLI/API 契约明确列出**（不建议删，除非先废弃 CLI 设计）：`documents/[id]/status`、`library/documents/[id]/content`、`library/documents/[id]/preview`、`knowledge/manage`、`rollback`、`versions`、`assets/generate-diagram`、`assets/batch-generate`、`assets/suggest-mermaid`——均在 `docs/cli-design.md` 列出。

**B 类：产品已宣传但 UI 未接完整**（建议补 UI，而非删 route）：`rollback`/`versions`——README:54 "stores section versions, and lets you roll back"；后端 confirm route 确实在写版本数据。

**C 类：设计文档明确为功能入口**（不建议删）：`wiki/synthesize`（`docs/wiki-synthesis-layer-design-2026-06-22.md:613` "手动触发"）、`knowledge/health`/`reset`（lifecycle 计划明确创建）。

**D 类：需确认是否仍有外部用途**：`auth/refresh`（认证职责文档列出，可能是未来 CLI/外部 SPA 入口）、`wiki/export`、`drafts/[id]/assemble`（被 export 取代，倾向可删但删前需 build+test）、`library/documents/[id]/tags`（无 UI，倾向可删）、`graph-reference`（`docs/dual-path-final-design.md:249` 设计过）、`audit` route（lib 在 generate 内部已调用）。

**建议**：逐条确认。只有 D 类的 `assemble`/`tags` 倾向可删，其余倾向保留或补 UI。

### 4.4 🟡 proxy.ts refresh token 不轮换（安全策略）

`src/proxy.ts:55-58` 刷新时用同一个 refresh payload 重新签发，**refresh token 从不轮换**。一旦 refresh token 泄露可无限续期。

**选项**：
- A）保持现状（本地自托管，威胁模型可接受）
- B）实现 refresh token 轮换（每次刷新签发新 refresh token，旧的失效）—— 安全提升但增加实现复杂度

### 4.5 🟡 proxy.ts 鉴权豁免过宽

`src/proxy.ts:34-40` 用 `.includes(".")` 兜底放过静态文件，但**任何含 `.` 的路径都跳过鉴权**（如未来 `/api/v1/users/avatar/foo.png`）。

**选项**：
- A）收紧为只豁免已知静态资源前缀（`/_next/`、`/favicon.ico` 等）
- B）保持现状（当前无含 `.` 的敏感 API 路径）

### 4.6 🟡 proxy.ts 与 session.ts 鉴权逻辑双份

`proxy.ts:42-77` 与 `lib/auth/session.ts:48-67` 各写了一份 token 验证 + refresh 逻辑，行为可能漂移。

**选项**：
- A）抽公共 `auth/middleware-core.ts`，两处复用 —— 消除漂移风险
- B）保持现状（两者职责不同：中间件层 vs 请求层）

### 4.7 🟡 proxy.ts 401 响应格式不统一

`proxy.ts:79-88` 返回 `{success:false, error:"Unauthorized"}` **不带 `code` 字段**，与 `api-helpers.authErrorResponse`（带 `code:"unauthorized"`）不一致，前端无法用统一 code 分支处理。

**选项**：
- A）统一为带 code 的格式 —— 前端错误处理更一致
- B）保持现状

### 4.8 🟡 6 个 dashboard 页面是否迁移到 hook 范式？

`library`、`wiki`、`documents`、`topology`、`dashboard` 首页都内联 fetch，而 `writing`、`brainstorm` 已用 hook。两套风格并存是屎山信号。

**选项**：
- A）逐步迁移（每个页面一个 PR）—— 一致性好，工作量大
- B）只迁 search（最严重），其余暂缓
- C）保持现状（功能正常，风格不统一）

---

## 6. 二次复核补充的遗漏项（P2，原方案未覆盖）

### 6.1 裸 `JSON.parse` 边界收敛（重要）

裸 `JSON.parse` 广泛存在，解析对象包括 `AsyncTask.inputData/resultData`、`SectionAsset.metadata`、`Section.constraints`、LLM JSON 输出、SSE line、前端错误 body。坏数据会让 route 直接 500。

代表位置：`library/page.tsx:56,76`、`writing/[id]/page.tsx:422`、`documents/[id]/reprocess/route.ts:55`、`drafts/[id]/generate-all/route.ts:21`、`tasks/route.ts:45`、`tasks/[id]/route.ts:45`、`reference-panel.tsx:168`。

**建议**：新增 `safeJsonParse<T>()` + Zod schema，优先覆盖 task、asset metadata、SSE parser 三类高频路径。不一次性全局机械替换。

### 6.2 空 `catch {}` 分类治理

大量空 catch（SSE controller、JSON parse fallback、UI/API fetch、worker/FS cleanup）。不是都错，但缺分类。

**建议**：intentional close/cleanup 加注释；parse fallback 用 `safeJsonParse`；UI/API 失败必须 toast/setError；后台副作用统一 `logger.warn`。

### 6.3 日志脱敏策略

大量 `console.warn/error` 可能输出 prompt、source snippet、stack、用户文档内容、provider 错误体。代表：`semantic.ts:435`（打印 stack）、`adapter.ts:205`（打印 SSE line slice）。

**建议**：建立轻量 logger，按模块 prefix、环境控制、禁止输出完整 prompt/source/content。优先处理 LLM/RAG/writing asset 路径。

### 6.4 历史优化文档整合

`docs/` 下已有多份优化文档（`code-optimization-guidance.md`、`maintainability-optimization-plan-2026-05-29.md`、`codebase-optimization-roadmap-2026-06-02.md`、`code-optimization-manual.md`、本文件），有重叠甚至冲突。

**建议**：把本文件确立为权威路线图，顶部注明与旧文档关系；旧文档标注 superseded 或归档。否则后续 AI 会据不同文档做相反决策。

### 6.5 README 其他陈旧项

除版本号（已修）外，README 的 Project Structure、Prerequisites（写 pnpm 但 package.json 用 npm）等也可能过时，建议后续核对。

---

## 7. 不建议立即改 / 保持现状

以下经评估后建议**不动**，避免过度重构：

| 项 | 理由 |
|---|---|
| `diagram-renderer.ts` (1206 行) | 结构清晰（布局+渲染两块），职责内聚，强行拆分收益低风险高。`renderNodeShape` 的 133 行 switch 是 SVG 字符串拼接的固有复杂度，难简化。**仅在新增 shape 时顺手拆。** |
| `knowledge/graph-canvas.tsx` (595 行) | d3-force + canvas 引擎，过程式是合理的。抽纯函数可提升可测性但非紧急。 |
| `audit.ts` + `auditor.ts` 两文件 | 名字像重复，实际是 prompt 构建 / 执行的合理两层分工，**非死代码**。 |
| `python.ts` vs `python-daemon.ts` | 顶部注释明确说明是有意设计（spawn 一次性 vs daemon 长驻共享 env 构建），**非重复**。 |
| `src/types/*` 与 Prisma 类型 | types 是前端 DTO 视图模型，Prisma 是 server 侧，**无双重维护风险**，设计合理。 |
| `console.log` (11 处) | 全在 `startup.ts`（DB 迁移日志）和 `model-catalog.ts`（缓存日志），属运维必需，可保留。如要规范可改用统一 logger，但非紧急。 |
| sidebar 内联 SVG 图标 (10 个) | 可改 lucide，但纯美化，不影响功能，优先级低。 |

---

## 8. 验证策略（确保不影响已开发功能）

每个 P2 项执行后，按下表回归测试：

| 改动类别 | 验证命令/动作 |
|---|---|
| 统一工具函数（5.1） | 相关单测 + 跑一次涉及模块的功能（如 estimateTokens 影响分词，跑一次文档上传+分块） |
| generator 去重（5.2） | 手动：章节生成 + A/B 对比生成，确认输出一致 |
| 组件拆分（5.4, 5.6） | 手动：完整走一遍写作流程 + 搜索流程 |
| 类型修复（5.5） | `tsc --noEmit` 报错定位 → 修复 → 通过 |
| safeJsonParse（6.1） | 相关 route 单测 + 手动触发坏数据路径 |

**通用基线**：每项改动后跑 `npx tsc --noEmit`（必须通过）+ `npm run test:run`（失败数不得高于既有 Prisma timeout flaky 基线）。

**关键原则**：每个改动**独立提交**，提交信息标注 `[refactor]`/`[chore]`，便于出问题时精准回滚。不要把多个改动揉在一个提交里。

---

## 9. 建议执行顺序

1. ✅ **Phase 0/1 已完成**（baseline 修复 + 安全清理）
2. **P2 低风险项**：5.1 工具函数统一、5.3 打字机、5.5 类型、5.7 Spinner、6.1 safeJsonParse
3. **P3 由你决策后**再动（API surface 审计需逐条确认）
4. **P2 重构项**：5.2 generator、5.4 reference-panel、5.6 search-page —— 每项独立 PR，充分测试

---

## 10. 已执行项验证记录（Phase 0 + Phase 1）

| Step | 改动 | tsc | test | 结论 |
|---|---|---|---|---|
| 0.1 | eslint.config.mjs 加 `dist/**` | — | — | ✅ lint 恢复可用 |
| 1.1 | startup.ts 删除 size 覆盖分支 | ✅ pass | ✅ 12 failed（全 Prisma timeout，无新增） | ✅ |
| 1.2 | generator.ts 删 3 个死符号（119 行） | ✅ pass | ✅ writing 53 测试全过 | ✅ |
| 1.3 | 删 GraphViewMode/PaginatedResponse/authOrError | ✅ pass | ✅ api-helpers+tasks 3 测试过 | ✅ |
| 1.4 | 4 个类型去 export | ✅ pass | ✅ 无新增失败 | ✅ |
| 1.5 | README 版本号 | — | — | ✅ 文档 |

**执行后 baseline**：tsc 通过；test 失败数 ≤ 执行前（Prisma timeout flaky）；lint 能正常输出。

---

## 附录 A：完整问题清单索引

| # | 位置 | 严重度 | 档位 | 类型 | 状态 |
|---|---|---|---|---|---|
| 0.1 | `eslint.config.mjs` dist 忽略 | 高 | Phase 0 | 基线 | ✅ |
| 0.2 | test Prisma timeout flaky | 中 | Phase 0 | 基线 | 待专项 |
| 0.3 | lint 诊断脚本噪声 | 低 | Phase 0 | 基线 | 待处理 |
| 1.1 | `startup.ts:24` 数据覆盖 | 🔴高 | Phase 1 | 数据安全 | ✅ |
| 1.2 | `generator.ts` 死函数 ×3 | 中 | Phase 1 | 死代码 | ✅ |
| 1.3 | 死类型/死函数 ×3 | 低 | Phase 1 | 死代码 | ✅ |
| 1.4 | 多余 export ×4 | 低 | Phase 1 | 死代码 | ✅ |
| 1.5 | README 版本号 | 低 | Phase 1 | 文档 | ✅ |
| 5.1 | 6 组重复工具函数 | 中 | P2 | 重复 | 待执行 |
| 5.2 | `generator.ts` 重复模板 | 中 | P2 | 重复 | 待执行 |
| 5.3 | editor-panel 打字机 ×3 | 中 | P2 | 重复 | 待执行 |
| 5.4 | reference-panel 733 行 | 中 | P2 | 臃肿 | 待执行 |
| 5.5 | ErrorCode 类型洞 | 中 | P2 | 类型安全 | 待执行 |
| 5.6 | search/page 584 行无 hook | 中-高 | P2 | 臃肿 | 待执行 |
| 5.7 | 手写 Spinner ×6 | 低-中 | P2 | 一致性 | 待执行 |
| 5.8 | 两套 markdown 渲染器 | 低-中 | P2 | 重复 | 待执行 |
| 6.1 | 裸 JSON.parse | 中-高 | P2 | 稳定性 | 待执行 |
| 6.2 | 空 catch {} 分类 | 中 | P2 | 稳定性 | 待执行 |
| 6.3 | 日志脱敏 | 中 | P2 | 安全 | 待执行 |
| 6.4 | 文档整合 | 中 | P2 | 维护 | 待执行 |
| 4.1 | API surface 审计（原 19 死 route） | — | P3 | 契约 | 待决策 |
| 4.2 | refresh token 不轮换 | 中 | P3 | 安全策略 | 待决策 |
| 4.3 | proxy 鉴权豁免过宽 | 中 | P3 | 安全策略 | 待决策 |
| 4.4 | proxy/session 鉴权双份 | 中 | P3 | 重复/策略 | 待决策 |
| 4.5 | proxy 401 格式不统一 | 低-中 | P3 | 一致性 | 待决策 |
| 4.6 | 6 页面 hook 范式迁移 | — | P3 | 策略 | 待决策 |

---

## 附录 B：审核排除项（避免凑数）

- 无完全未被引用的死组件文件 / 死 hook 文件（components、hooks 全部活跃）
- `src/types/*` 与 Prisma 生成层无重叠（DTO 设计合理）
- 无 server/client 组件边界硬伤
- `audit.ts`/`auditor.ts`、`python.ts`/`python-daemon.ts` 是合理分工非重复
- `knowledge/health.ts` 的 `isRecordForActiveDocument` 与 `isRecord` 同名不同义，非重复
- 0 TODO、0 ts-suppress、0 any 滥用（生产代码）——纪律良好

---

*Phase 0 + Phase 1 已执行并验证。后续 P2/P3 项请在确认后逐项实施，每项独立提交 + 回归测试（`npx tsc --noEmit` + `npm run test:run` + 相关功能手动验证）。*
