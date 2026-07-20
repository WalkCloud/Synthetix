# Changelog

All notable changes to Synthetix are documented in this file.
Synthetix 的所有重要变更均记录在此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
