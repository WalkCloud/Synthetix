# Changelog / 更新日志

All notable changes to Synthetix are documented in this file.
Synthetix 的所有重要变更均记录在此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.0.3] — 2026-07-17

### Security / 安全

- **Updater trust chain hardened / 更新器信任链加固**: Download phase now consumes a cached, verified asset descriptor instead of re-fetching the manifest, eliminating TOCTOU attacks. / 下载阶段使用缓存的经验证资源描述符，不再重新获取 manifest，消除 TOCTOU 攻击。
- **Settings secrets encrypted at rest / 设置密钥磁盘加密**: S3, PostgreSQL, Neo4j, Milvus, and Qdrant credentials are now AES-256-GCM encrypted on disk; GET APIs return masked placeholders only. / S3、PostgreSQL、Neo4j、Milvus、Qdrant 凭证现在使用 AES-256-GCM 加密存储；GET 接口仅返回掩码占位符。
- **Access/Refresh token separation / Access/Refresh 令牌分离**: JWT tokens now carry a `kind` field; ordinary API calls reject refresh tokens. / JWT 令牌现在包含 `kind` 字段；普通 API 调用拒绝 refresh 令牌。
- **Login rate limiting / 登录限流**: IP-based and account-based throttling with `Retry-After` headers. / 基于 IP 和账号的双维度限流，返回 `Retry-After` 头。
- **SectionAsset ownership / 资产所有权校验**: File serving now verifies draft ownership before returning assets. / 文件服务在返回资产前验证草稿所有权。
- **ModelConfig ownership / 模型配置所有权**: Explicit model config resolution checks `provider.userId`. / 显式模型配置解析检查 `provider.userId`，防止跨用户使用。
- **Python API key transport / Python 密钥传输**: API keys moved from process arguments to environment variables. / API 密钥从进程参数迁移到环境变量，避免在 `ps` 中暴露。
- **Unsigned update policy / 未签名更新策略**: Packaged builds reject unsigned manifests; fail-closed. / 打包构建拒绝未签名 manifest，失败时关闭更新。

### Architecture — Task Lifecycle & Cancellation / 任务生命周期与取消

- **Two-phase cancellation / 两阶段取消**: Running tasks transition to `cancel_requested` (non-terminal) before the worker settles; terminal `cancelled` is written only when the actual worker Promise completes. / 运行中的任务先转为 `cancel_requested`（非终态），worker Promise 完成后才写入终态 `cancelled`。
- **AbortSignal-aware execution context / AbortSignal 感知执行上下文**: All workers now receive a `TaskExecutionContext` with `signal`, `reportProgress`, `heartbeat`, and `throwIfCancelled`. / 所有 worker 现在接收包含 `signal`、`reportProgress`、`heartbeat`、`throwIfCancelled` 的 `TaskExecutionContext`。
- **LLM adapter cancellation / LLM 适配器取消**: `fetchWithTimeout` merges caller signals; retry backoff aborts immediately on cancel; streaming loops race against abort. / `fetchWithTimeout` 合并调用方信号；重试退避在取消时立即中止；流式读取循环加入 abort 竞态。
- **Durable leases & generation fencing / 持久租约与 generation 围栏**: Claim sets `leaseOwner`/`leaseExpiresAt`/`executionGeneration`; terminal commits fenced by generation; `drain()` only recovers tasks with expired leases. / 领取任务时设置 lease owner/expiry/generation；终态提交使用 generation 围栏；重启恢复只恢复过期 lease 的任务。
- **Bulk draft stop/resume / 批量草稿停止/继续**: "Generate Full Draft" now has Stop and Resume buttons; status bar survives page refresh. / "生成完整草稿"新增停止和继续按钮；状态栏在页面刷新后恢复。

### Architecture — Task Identity / 任务身份关系化

- **Relational identity fields / 关系化身份字段**: `documentId`, `draftId`, `sectionId`, `sessionId`, `operationId`, `parentTaskId`, `attempt` added to `AsyncTask` schema with indexes. / `AsyncTask` 新增七个 nullable 关系字段及索引。
- **Dual-write & backfill / 双写与回填**: New tasks dual-write relational identity while preserving legacy `inputData`; historical backfill via `pnpm backfill:task-identity`. / 新任务双写关系身份并保留旧 `inputData`；历史数据通过回填命令迁移。
- **Query migration / 查询迁移**: Task lookups migrated from JSON `LIKE` to relational column equality with null-only legacy fallback, preventing UUID substring mismatches. / 任务查询从 JSON `LIKE` 迁移到关系列等值匹配，仅在字段为 null 时回退到旧方式，防止 UUID 子串误匹配。

### Features / 功能

- **Wiki auto-retry / Wiki 自动重试**: Incomplete wiki synthesis units are automatically retried up to 2 times using crash-durable checkpoint resume. / Wiki 合成中失败的单元自动重试最多 2 次，利用崩溃耐久 checkpoint 恢复。
- **Wiki checkpoint v2**: Crash-durable temp-write → fsync → rename → directory-sync. / 崩溃耐久的临时写入 → fsync → 重命名 → 目录同步。
- **Secret clearing semantics / 密钥清除语义**: Explicit `clearSecrets` API; empty values mean "preserve", not "clear". / 显式 `clearSecrets` API；空值表示"保留"而非"清除"。
- **Writing policy matrix / 写作策略矩阵**: Compare mode now uses the same Wiki retrieval + RAG policy as single mode. / 对比模式现在使用与单模型模式相同的 Wiki 检索 + RAG 策略。
- **Typed SSE schema / 类型化 SSE 事件**: `SSEEventType` union and `parseSSEEvent` helper for client-side reducers. / `SSEEventType` 类型联合和 `parseSSEEvent` 辅助函数。
- **Compare view selection fix / 对比视图选择修复**: When both models are identical, only the selected panel shows highlight. / 当两个模型相同时，只有选中的面板显示高亮。

### Search / 搜索

- **Removed 2,000-chunk search cap / 移除 2000 chunk 搜索上限**: Semantic search now scans all chunks in batches with running top-k. / 语义搜索现在分批扫描所有 chunk 并维护滚动 top-k。

### CI/Build / 持续集成与构建

- **Clean-checkout pnpm CI / 干净 checkout pnpm CI**: GitHub Actions uses frozen-lockfile install with full validation chain. / GitHub Actions 使用 frozen-lockfile 安装和完整验证链。
- **`ignoreBuildErrors` removed / 移除忽略构建错误**: Next.js production build now enforces TypeScript strict mode. / Next.js 生产构建现在强制 TypeScript 严格模式。
- **PostgreSQL fail-fast / PostgreSQL 快速失败**: Main application explicitly rejects PostgreSQL configuration. / 主应用显式拒绝 PostgreSQL 配置。

---

## [1.0.2] — 2026-07-15

### Added

- **Knowledge graph management**: entity CRUD and merge operations in `rag_manage.py`.
- **Adaptive LLM concurrency**: capacity tracking and adaptive limiter for smarter request throttling.
- **Knowledge graph screenshots**: bilingual force-directed graph views in README.

### Changed

- **README overhaul**: rewritten with pain-point narrative, three-layer knowledge architecture, and full product tour.
- **Screenshot sanitization**: all product screenshots re-captured with sensitive info masked.

### Removed

- Cleaned up dev-only diagnostic scripts and build artifacts.

### Fixed

- `rag_index.py` and `rag_query.py` robustness improvements.

---

## [1.0.1] — 2026-07-10

### Added

- **Auto-update system**: Ed25519-signed manifest for secure in-app update checks.
- **Third-party notices**: auto-generated open-source license notices, viewable in-app.
- **About dialog**: version info, update status, and legal links.
- **Release tooling**: one-command GitHub Releases publishing.

### Changed

- **Code quality optimization**: refactored core modules for maintainability.

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
