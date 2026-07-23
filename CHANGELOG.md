# Changelog

All notable changes to Synthetix are documented in this file.
Synthetix 的所有重要变更均记录在此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## Known Issues · 已知待修复问题

### Restart during processing silently drops "Full Analysis" graph mode · 处理中途重启会静默丢失"完整分析"图谱模式

EN: If the app is restarted (or `npm run dev` hot-reloads) while a document is mid-processing (`queued` / `converting` / `splitting`), the crash-recovery path (`recoverOrphanedPhaseOne`) resubmits the document with empty `{}` options instead of the user's original "Full Analysis" (`indexMode: "graph"`) choice. The document still reaches `ready`, but the knowledge-graph entity/relation extraction never enqueues — so the Knowledge Graph page shows "暂无拓扑数据" with no error or warning. Basic search and Wiki remain functional. Tracked in [`docs/known-issue-restart-drops-graph-mode.md`](docs/known-issue-restart-drops-graph-mode.md) with root-cause analysis and proposed fixes. **Workaround**: avoid restarting during processing; if already affected, re-upload the document or reprocess with Full Analysis.

CN: 若在文档处理过程中（`queued` / `converting` / `splitting` 状态）重启程序（或 `npm run dev` 热重载），崩溃恢复路径（`recoverOrphanedPhaseOne`）会用空 `{}` 选项重新提交文档，而非用户原本选择的"完整分析"（`indexMode: "graph"`）。文档仍会变为 `ready`，但知识图谱的实体/关系抽取任务从未排队——于是知识图谱页显示"暂无拓扑数据"，且无任何错误或警告。基础检索与 Wiki 提炼不受影响。根因分析与修复建议见 [`docs/known-issue-restart-drops-graph-mode.md`](docs/known-issue-restart-drops-graph-mode.md)。**规避方法**：处理过程中避免重启；若已发生，删除文档重新上传或以"完整分析"重新处理即可。

## [1.1.0] — 2026-07-23

### API Access Keys & MCP Integration · API 访问密钥与 MCP 集成

Adds a programmatic authentication channel so external AI agents can drive the app without a browser session, and a companion MCP server to bridge them.

- **API access keys**
  EN: A new authentication path alongside cookie/JWT login. Users create keys in Settings → API Keys (plaintext shown once, stored as SHA-256 hash, soft-revoke). All existing `/api/v1/*` routes accept `Authorization: Bearer <key>` with zero route-handler changes — `getAuthUser()` falls back to Bearer after cookie auth fails, and `proxy.ts` lets Bearer-carrying `/api/*` requests through.
  CN: 在 cookie/JWT 登录之外新增程序化鉴权通道。用户在「设置 → API 密钥」创建 key(明文仅显示一次,SHA-256 哈希存储,支持软吊销)。所有现有 `/api/v1/*` 路由零改动即支持 `Authorization: Bearer <key>`——`getAuthUser()` 在 cookie 鉴权失败后回退到 Bearer,`proxy.ts` 放行带 Bearer 的 `/api/*` 请求。

- **Companion MCP server (`@walkcloud/synthetix-mcp`)**
  EN: A separate repository ([synthetix-mcp-tools](https://github.com/WalkCloud/synthetix-mcp-tools)) exposes 33 tools (documents, knowledge, brainstorm, writing with dual-model compare, export, models, token usage) and 6 workflow prompts to Claude Code / Codex / OpenCode via the Model Context Protocol. Install with one line: `npx -y @walkcloud/synthetix-mcp`. See the MCP repo's README for configuration.
  CN: 配套 MCP server(独立仓库 [synthetix-mcp-tools](https://github.com/WalkCloud/synthetix-mcp-tools))通过 Model Context Protocol 向 Claude Code / Codex / OpenCode 暴露 33 个工具(文档、知识库、头脑风暴、写作含双模型对比、导出、模型管理、token 用量)和 6 个工作流 prompt。一行安装:`npx -y @walkcloud/synthetix-mcp`,配置见 MCP 仓库 README。

## [1.0.6] — 2026-07-23

### Docling Upgrade · 文档转换引擎升级

Upgrades the Python document-conversion engine and adds dimension guidance for embedding models.

- **Docling upgraded from 2.107.0 to 2.114.0**
  EN: The `docling` version constraint in `workers/python/requirements.txt` is raised to `>=2.114.0`. The new release adds legacy binary Office format (97–2004) support and a VideoPipeline, and includes upstream rendering refinements. The conversion cache version is bumped from 3 to 4 so existing caches are invalidated and documents are re-converted with the new engine.
  CN: `workers/python/requirements.txt` 中的 `docling` 版本约束提升至 `>=2.114.0`。新版本增加了旧版二进制 Office 格式（97–2004）支持和 VideoPipeline，并包含上游渲染改进。转换缓存版本号从 3 提升至 4，使现有缓存失效，文档将以新引擎重新转换。

- **Hardened docx/pptx performance patches**
  EN: The monkeypatched backend methods in `convert.py` (`_get_format_from_run`, `_handle_pictures`, `_handle_vml_pictures`, `_handle_drawingml`) now check `hasattr` before assignment. If an upstream Docling refactor renames an internal method, a WARNING is logged instead of silently no-op'ing — making a potential performance regression observable after the upgrade.
  CN: `convert.py` 中 monkeypatch 的后端方法（`_get_format_from_run`、`_handle_pictures`、`_handle_vml_pictures`、`_handle_drawingml`）现在在赋值前进行 `hasattr` 检查。如果上游 Docling 重构重命名了内部方法，会打印 WARNING 而非静默失效——使升级后潜在的性能回退可被观察。

### Embedding Model Dimension Guidance · 嵌入模型维度指引

Helps users pick graph-compatible embedding models and warns when a model is too small.

- **Inline warning when embedding dimension < 1536**
  EN: When adding or editing an embedding model in Model Management, if the entered or auto-detected dimension is below 1536 (the LightRAG minimum for knowledge-graph entity extraction), an amber warning is shown immediately below the dimension field explaining that the model cannot be used for Knowledge Graph mode.
  CN: 在模型管理中添加或编辑嵌入模型时，如果填入或自动检测到的维度低于 1536（LightRAG 知识图谱实体抽取的最低要求），维度字段下方会立即显示琥珀色警告，说明该模型无法用于知识图谱模式。

- **README: recommended embedding models table**
  EN: A new "Recommended embedding models for the knowledge graph" section lists 22 cloud embedding models (OpenAI, Google, Amazon, Alibaba, ByteDance, Zhipu, Tencent, etc.) with their dimensions and notes, so users know which services to choose for graph-enhanced retrieval. Available in both English and Chinese.
  CN: README 新增"知识图谱推荐嵌入模型"章节，汇总 22 个云端嵌入模型（OpenAI、Google、Amazon、阿里云、字节跳动、智谱、腾讯等）的维度和备注，方便用户选择支持图谱增强检索的服务。中英文版本同步。

### Knowledge Graph Reliability · 知识图谱可靠性

Systemic fixes to prevent heartbeat timeouts from killing long-running graph extraction, cleanup, and indexing tasks.

- **Queue auto-heartbeat (architectural safety net)**
  EN: Every running task now gets an automatic heartbeat update every 60 seconds, regardless of whether the worker remembers to emit progress events. This prevents the 5-minute heartbeat scanner from falsely killing long-running tasks (graph extraction on large documents, RAG cleanup with 3000+ entities, etc.). Workers that DO emit progress still work normally — the auto-heartbeat is additive.
  CN: 每个 running 任务现在自动每 60 秒更新心跳，无论 worker 是否主动发送进度事件。这防止了 5 分钟心跳扫描器误杀长时间运行的任务（大文档图谱抽取、3000+ 实体的 RAG 清理等）。主动发送进度的 worker 仍然正常工作——自动心跳是叠加的。

- **Graph/cleanup heartbeat fixes**
  EN: `buildGraphTaskProgressUpdate` now writes the `heartbeatAt` DB column (previously only wrote `resultData.lastHeartbeatAt` JSON). `manageRag` delete-by-doc passes progress events to the cleanup worker so RAG purge operations stay alive past the 5-min threshold. `manageRag` timeout raised from 120s to 10min for large-graph deletion.
  CN: `buildGraphTaskProgressUpdate` 现在写入 `heartbeatAt` 数据库列（之前只写 `resultData.lastHeartbeatAt` JSON）。`manageRag` 的 delete-by-doc 操作将进度事件传递给清理 worker，使 RAG purge 操作能安全度过 5 分钟门槛。`manageRag` 超时从 120s 提升到 10 分钟。

- **RAG mutation lock timeout 5min → 4h**
  EN: The per-user RAG mutation lock wait timeout was raised from 5 minutes to 4 hours (aligned with the graph-index task budget). Lock-wait now emits heartbeat events so waiting tasks are not falsely stalled. This fixes the root cause of large-document graph extraction failing after 3 retry attempts.
  CN: 按用户的 RAG 互斥锁等待超时从 5 分钟提升到 4 小时（与图谱索引任务预算对齐）。锁等待期间现在发送心跳事件，避免等待中的任务被误判为停滞。这修复了大文档图谱抽取在 3 次重试后失败的根因。

- **Document cleanup retry mechanism**
  EN: `document_cleanup` tasks now retry up to 2 times (3 total attempts) on transient failures (timeout, lock contention), with a 60s delay. Previously cleanup had NO retry — a single failure left orphan graph entities permanently visible until the next unrelated delete triggered a cleanup pass.
  CN: `document_cleanup` 任务现在在瞬时失败（超时、锁竞争）时最多重试 2 次（共 3 次尝试），间隔 60 秒。之前清理完全没有重试——单次失败会导致孤儿图谱实体永久可见，直到下一次无关的删除触发清理。

- **Knowledge graph neighbor labels**
  EN: Clicking a node in the knowledge graph now shows labels for all connected neighbor nodes immediately, without needing to zoom in. Previously, low-degree edge nodes were hidden until the user manually enlarged the view.
  CN: 点击知识图谱节点后，所有关联邻居节点的标签立即显示，无需放大。之前低度数边缘节点的标签被隐藏，直到用户手动放大视图。

### Elastic LLM Concurrency · 弹性 LLM 并发

- **Adaptive concurrency for graph extraction**
  EN: LightRAG's internal Semaphore is now set to 4× the AIMD limiter cap (64 vs 16), making the adaptive limiter the sole concurrency bottleneck. The AIMD budget starts at 64000 tokens (concurrency 16) instead of crawling up from the floor. Slow-start threshold reduced from 8 to 4 successes for faster recovery after 429 rate-limiting. Stale-low persisted ceilings no longer cripple startup — `get_limiter` overrides them with the optimistic initial value.
  CN: LightRAG 内部 Semaphore 设为 AIMD 限流器上限的 4 倍（64 vs 16），使自适应限流器成为唯一的并发瓶颈。AIMD 预算从 64000 tokens（并发 16）启动，不再从地板值缓慢爬升。慢启动阈值从 8 次成功降低到 4 次，加速 429 限流后的恢复。过低的持久化 ceiling 不再拖累启动——`get_limiter` 用乐观初始值覆盖它。

## [1.0.5] — 2026-07-20

### RAG Cross-Document Integrity · 跨文档知识图谱完整性

This is the headline fix of v1.0.5. Previously, deleting one document could corrupt the knowledge graph and Wiki data of *other* documents sharing the same RAG workspace, and cleanup tasks sometimes timed out or silently failed on large documents.

- **Per-user RAG mutation lock**
  EN: All RAG workspace writes (insert, delete, re-index) are now serialized through a per-user mutation lock held outside the RAG workspace itself, preventing concurrent writers from corrupting each other's data. The lock is fail-closed: if it cannot be acquired, the operation returns an error instead of proceeding unsafely.
  CN: 所有 RAG 工作区的写操作（插入、删除、重建索引）现在通过按用户的互斥锁串行化，锁目录位于 RAG 工作区之外，防止并发写入互相破坏数据。锁采用 fail-closed 策略：获取失败时返回错误而非不安全地继续。

- **Document deletion now reliably purges graph + Wiki data**
  EN: Deleting a document with `deleteWiki=true` now correctly purges: LightRAG entity/relation sources, GraphML sources, chunk files, document-scoped caches, and Wiki references — all scoped to the deleted document only. Other documents' graph data is preserved intact.
  CN: 使用 `deleteWiki=true` 删除文档时，现在会正确清理：LightRAG 实体/关系源、GraphML 源、chunk 文件、文档级缓存和 Wiki 引用 —— 全部仅限被删除文档的范围，其他文档的图谱数据完整保留。

- **Removed destructive implicit recovery**
  EN: The old "wipe and rebuild" recovery path (which could destroy other documents' LightRAG data on embedding mismatches) has been removed. RAG failures now return errors instead of attempting workspace-wide destructive recovery.
  CN: 移除了旧的"擦除并重建"恢复路径（该路径在嵌入维度不匹配时可能破坏其他文档的 LightRAG 数据）。RAG 失败现在返回错误而非尝试工作区范围的破坏性恢复。

- **Canonical writable RAG root**
  EN: A single canonical writable RAG root is enforced for all operations, eliminating the race between multiple roots that previously allowed cross-document data leakage.
  CN: 所有操作强制使用单一规范的可写 RAG 根目录，消除了之前多根目录导致的跨文档数据泄漏竞态。

- **Batch chunk deletion for large documents**
  EN: Graph index cleanup now deletes chunks in batches, preventing heartbeat timeouts that previously caused cleanup tasks to stall on large documents (>100 chunks).
  CN: 图谱索引清理现在批量删除 chunk，防止大文档（>100 chunk）上心跳超时导致清理任务卡住。

- **Document-scoped LightRAG graph insert verification**
  EN: After inserting graph data, the system verifies that child documents have corresponding chunks, preventing silent data loss during indexing.
  CN: 插入图谱数据后，系统验证子文档是否有对应的 chunk，防止索引过程中静默数据丢失。

- **Comprehensive cross-document test coverage**
  EN: New test suites verify that purging document A preserves B and C (symmetric), that embedding mismatches don't destroy the workspace, that query operations don't delete writer locks, and that storage corruption is fail-closed.
  CN: 新增测试套件验证：删除文档 A 时 B/C 完好（对称验证）、嵌入维度不匹配不破坏工作区、查询操作不删除写入锁、存储损坏时 fail-closed。

### Stability & Cancellation · 稳定性与取消机制

- **AbortSignal forwarded to Python RAG workers**
  EN: HTTP request cancellation now propagates through to `rag_manage` Python subprocesses via AbortSignal, so canceling a document reprocess actually stops the Python writer instead of letting it run orphaned.
  CN: HTTP 请求取消现在通过 AbortSignal 传播到 `rag_manage` Python 子进程，取消文档重新处理时实际停止 Python 写入器而非让其成为孤儿进程。

- **Python writer abort on timeout/stall**
  EN: Queue timeout and heartbeat stall now abort Python writers before completing cancellation, preventing zombie processes from holding RAG locks.
  CN: 队列超时和心跳停滞现在在完成取消前中止 Python 写入器，防止僵尸进程持有 RAG 锁。

### Knowledge Graph UI · 知识图谱交互优化

- **Entity evidence panel improvements**
  EN: The entity evidence panel now shows cleaner source attribution and handles document-scoped evidence more clearly.
  CN: 实体证据面板现在显示更清晰的来源归因，更好地处理文档级证据。

- **Topology stats refinement**
  EN: Statistics display streamlined; counts now use localized number formatting and update more reliably.
  CN: 统计显示精简优化；计数现在使用本地化数字格式并更可靠地更新。

- **Search page performance**
  EN: Knowledge graph indexing progress indicator no longer causes unnecessary re-renders.
  CN: 知识图谱索引进度指示器不再导致不必要的重渲染。

### Online Update System · 在线更新系统

- **Sidebar upgrade reminder**
  EN: When a new version is detected, a badge appears in the sidebar with a one-click "update now" flow. Version consistency gate ensures the installer, About dialog, and update manifest all report the same version.
  CN: 检测到新版本时，侧边栏出现徽章提示，支持一键更新。版本一致性门控确保安装器、关于对话框和更新清单报告相同版本。

- **Full / patch upgrade pipeline**
  EN: The updater now supports both full installer replacement and patch-based differential updates, with Ed25519-signed manifests and SHA-256 verified downloads.
  CN: 更新器现在支持完整安装器替换和基于补丁的差分更新，使用 Ed25519 签名清单和 SHA-256 验证下载。

### macOS Support · macOS 支持

- **macOS arm64 DMG packaging** (new platform)
  EN: Synthetix now builds and runs on Apple Silicon Macs (macOS 12.0+). Includes `.icns` icon, traffic-light-aware sidebar padding, Dock activation handling, and ad-hoc re-signing to fix "damaged" Gatekeeper warnings.
  CN: Synthetix 现在可在 Apple Silicon Mac（macOS 12.0+）上构建和运行。包含 `.icns` 图标、适配交通灯按钮的侧边栏内边距、Dock 激活处理，以及修复"已损坏"Gatekeeper 警告的 ad-hoc 重签名。

### Packaging & CI · 打包与持续集成

- **Windows installer runtime crash fixes**
  EN: Resolved 8 root causes that prevented the v1.0.5 Windows installer from launching: Next.js standalone dependency tracing (Prisma/better-sqlite3), electron-builder stripping node_modules from extraResources, torchgen trim breaking Python runtime, missing node-gyp in CI, build-time JWT_SECRET requirement, and publish workflow race conditions.
  CN: 修复了阻止 v1.0.5 Windows 安装器启动的 8 个根因：Next.js standalone 依赖追踪（Prisma/better-sqlite3）、electron-builder 从 extraResources 中剥离 node_modules、torchgen 裁剪破坏 Python 运行时、CI 缺少 node-gyp、构建时 JWT_SECRET 要求、以及发布工作流竞态条件。

- **Unified runtime version matrix**
  EN: Node.js, pnpm, Python, and Electron versions are now pinned in a single `config/runtime-versions.json`, with SHA-256 verification for all downloaded runtime assets. CI and both platform sidecars read from this one source.
  CN: Node.js、pnpm、Python 和 Electron 版本现在统一锁定在 `config/runtime-versions.json`，所有下载的运行时资产均有 SHA-256 校验。CI 和两个平台的构建脚本都从此单一来源读取。

---

## [1.0.4] — 2026-07-19 (tag exists, no public release — superseded by 1.0.5)

v1.0.4 was tagged but never publicly released due to CI failures (Node/pnpm version incompatibility on the Windows runner). All v1.0.4 work is included in v1.0.5. This entry documents the changes for historical reference.

- **Cross-platform release preparation**
  EN: Unified the Windows and macOS build pipelines, added macOS bundle assembler, and established the two-machine release workflow documented in the release guide.
  CN: 统一 Windows 和 macOS 构建流水线，添加 macOS bundle 组装器，建立发布指南中记录的双机发布工作流。

- **Windows regression checklist**
  EN: Added a comprehensive Windows regression verification checklist covering clean install, first-run, document processing, knowledge graph, and uninstall scenarios.
  CN: 添加了全面的 Windows 回归验证清单，覆盖全新安装、首次运行、文档处理、知识图谱和卸载场景。

---

## [1.0.3] — 2026-07-17

### Security · 安全

- **Updater trust chain hardened**
  EN: Download phase now consumes a cached, verified asset descriptor instead of re-fetching the manifest, eliminating TOCTOU attacks on the update URL and SHA-256.
  CN: 下载阶段使用缓存的经验证资源描述符，不再重新获取 manifest，消除 TOCTOU 攻击。

- **Settings secrets encrypted at rest**
  EN: S3, PostgreSQL, Neo4j, Milvus, and Qdrant credentials are now AES-256-GCM encrypted on disk; GET APIs return masked placeholders only.
  CN: S3、PostgreSQL、Neo4j、Milvus、Qdrant 凭证现在使用 AES-256-GCM 加密存储；GET 接口仅返回掩码占位符。

- **Access / Refresh token separation**
  EN: JWT tokens now carry a `kind` field (`access` | `refresh`); ordinary API calls reject refresh tokens.
  CN: JWT 令牌现在包含 `kind` 字段；普通 API 调用拒绝 refresh 令牌。

- **Login rate limiting**
  EN: IP-based and account-based throttling with `Retry-After` headers.
  CN: 基于 IP 和账号的双维度限流，返回 `Retry-After` 头。

- **SectionAsset & ModelConfig ownership**
  EN: File serving and model config resolution now verify user ownership before returning results.
  CN: 文件服务和模型配置解析在返回结果前验证用户所有权。

- **Python API key transport**
  EN: API keys moved from process arguments (visible in `ps`) to environment variables.
  CN: API 密钥从进程参数迁移到环境变量，避免在进程列表中暴露。

- **Unsigned update fail-closed**
  EN: Packaged builds reject unsigned manifests; updates fail closed instead of proceeding.
  CN: 打包构建拒绝未签名 manifest，失败时关闭更新而非继续。

### Task Lifecycle & Cancellation · 任务生命周期与取消

- **Two-phase cancellation**
  EN: Running tasks transition to `cancel_requested` (non-terminal) before the worker settles; terminal `cancelled` is written only when the actual worker Promise completes.
  CN: 运行中的任务先转为 `cancel_requested`（非终态），worker Promise 完成后才写入终态 `cancelled`。

- **AbortSignal-aware execution context**
  EN: All workers now receive a `TaskExecutionContext` with `signal`, `reportProgress`, `heartbeat`, and `throwIfCancelled`.
  CN: 所有 worker 现在接收包含 `signal`、`reportProgress`、`heartbeat`、`throwIfCancelled` 的执行上下文。

- **LLM adapter cancellation**
  EN: `fetchWithTimeout` merges caller signals; retry backoff aborts immediately on cancel; OpenAI and Anthropic streaming loops race against abort.
  CN: `fetchWithTimeout` 合并调用方信号；重试退避在取消时立即中止；流式读取循环加入 abort 竞态。

- **Durable leases & generation fencing**
  EN: Claim sets `leaseOwner` / `leaseExpiresAt` / `executionGeneration`; terminal commits fenced by generation; `drain()` only recovers tasks with expired leases.
  CN: 领取任务时设置 lease owner / expiry / generation；终态提交使用 generation 围栏；重启恢复只恢复过期 lease 的任务。

- **Bulk draft stop / resume**
  EN: "Generate Full Draft" now has Stop and Resume buttons; status bar survives page refresh.
  CN: "生成完整草稿"新增停止和继续按钮；状态栏在页面刷新后恢复。

### Task Identity · 任务身份关系化

- **Relational identity fields**
  EN: `documentId`, `draftId`, `sectionId`, `sessionId`, `operationId`, `parentTaskId`, `attempt` added to `AsyncTask` schema with composite indexes.
  CN: `AsyncTask` 新增七个 nullable 关系字段及复合索引。

- **Dual-write & backfill**
  EN: New tasks dual-write relational identity while preserving legacy `inputData`; historical backfill via `pnpm backfill:task-identity`.
  CN: 新任务双写关系身份并保留旧 `inputData`；历史数据通过回填命令迁移。

- **Query migration**
  EN: Task lookups migrated from JSON `LIKE` to relational column equality with null-only legacy fallback, preventing UUID substring mismatches.
  CN: 任务查询从 JSON `LIKE` 迁移到关系列等值匹配，仅在字段为 null 时回退，防止 UUID 子串误匹配。

### Features · 功能改进

- **Wiki auto-retry**
  EN: Incomplete wiki synthesis units (failed LLM calls) are automatically retried up to 2 times using crash-durable checkpoint resume.
  CN: Wiki 合成中失败的单元自动重试最多 2 次，利用崩溃耐久 checkpoint 恢复。

- **Wiki checkpoint v2**
  EN: Crash-durable temp-write → fsync → rename → directory-sync; failed writes preserve the prior checkpoint.
  CN: 崩溃耐久的临时写入 → fsync → 重命名 → 目录同步；写入失败时保留上一个 checkpoint。

- **Secret clearing semantics**
  EN: Explicit `clearSecrets` API for settings; empty values mean "preserve", not "clear".
  CN: 新增显式 `clearSecrets` API；空值表示"保留"而非"清除"。

- **Writing policy alignment**
  EN: Compare mode now uses the same Wiki retrieval + RAG policy as single mode.
  CN: 对比模式现在使用与单模型模式相同的 Wiki 检索 + RAG 策略。

- **Typed SSE schema**
  EN: `SSEEventType` union and `parseSSEEvent` helper for client-side reducers.
  CN: 类型化 SSE 事件联合和解析辅助函数，支持客户端 reducer。

- **Compare view selection fix**
  EN: When both models are identical, only the selected panel shows highlight + "selected" badge.
  CN: 当两个模型相同时，只有选中的面板显示高亮和"已选择"标记。

### Search · 搜索

- **Removed 2,000-chunk search cap**
  EN: Semantic search now scans all chunks in batches with running top-k, eliminating silent recall holes on large libraries.
  CN: 语义搜索现在分批扫描所有 chunk 并维护滚动 top-k，消除大型知识库中的静默召回缺口。

### CI / Build · 持续集成与构建

- **Clean-checkout pnpm CI**
  EN: GitHub Actions uses frozen-lockfile install with full validation chain (prisma generate → electron compile → typecheck → lint → test → build).
  CN: GitHub Actions 使用 frozen-lockfile 安装和完整验证链。

- **TypeScript strict enforcement**
  EN: `next.config.ts` no longer ignores build errors; production build enforces strict type checking.
  CN: 生产构建不再忽略类型错误，强制 TypeScript 严格模式。

- **PostgreSQL fail-fast**
  EN: Main application explicitly rejects PostgreSQL configuration with a clear error message.
  CN: 主应用显式拒绝 PostgreSQL 配置并返回明确错误信息。

---

## [1.0.2] — 2026-07-15

### Added

- Knowledge graph management: entity CRUD and merge operations.
- Adaptive LLM concurrency: capacity tracking and adaptive limiter.
- Knowledge graph screenshots: bilingual force-directed graph views.

### Changed

- README overhaul with pain-point narrative and full product tour.
- Screenshot sanitization: all product screenshots masked for sensitive info.

### Removed

- Cleaned up dev-only diagnostic scripts and build artifacts.

---

## [1.0.1] — 2026-07-10

### Added

- Auto-update system with Ed25519-signed manifest.
- Third-party open-source license notices (in-app).
- About dialog: version info, update status, legal links.
- Release tooling: one-command GitHub Releases publishing.

### Changed

- Code quality optimization: refactored core modules for maintainability.

---

## [1.0.0] — 2026-06-28

### Initial Release

- Document upload, conversion (Docling), chunking, embedding, and FTS indexing.
- LightRAG knowledge graph with entity extraction and relationship mapping.
- Wiki synthesis with multi-source fusion and confidence scoring.
- Brainstorm-to-outline-to-draft writing workflow.
- Section-level generation with single model and A/B compare modes.
- Reference panel with RAG, Wiki, and graph sources.
- Export to Markdown, PDF, and DOCX.
- Electron desktop app with auto-update.
