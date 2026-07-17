# Changelog

All notable changes to Synthetix are documented in this file.
Synthetix 的所有重要变更均记录在此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
