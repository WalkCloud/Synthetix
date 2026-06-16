# Synthetix 最终优化方案

> 日期：2026-06-03  
> 基于：全量代码深度审查（57 个文件，4 个专项审查）× 路线图 `codebase-optimization-roadmap-2026-06-02.md` 交叉验证  
> 审查范围：25 个 backend lib 文件、15 个 thick route、17 个前端组件/hooks、10 个 Python/Node 接口文件

---

## 一、总体判断

路线图的核心判断准确——项目处于功能闭环后的维护期，优先级排序合理。但深度审查发现了 **12 个路线图未覆盖的 Critical 问题** 和 **3 处路线图事实性偏差**。以下按优先级整合所有发现。

---

## 二、路线图事实性偏差修正

| # | 路线图声称 | 实际代码 | 修正 |
|---|-----------|---------|------|
| 1 | Python worker 已新增 `--pass-dimensions` | 实际使用 `--embed-dim`，`send_dimensions=True` 在 index/manage 中硬编码，query 中缺失 | 路线图 Batch 3 测试用例需基于实际参数设计 |
| 2 | Python worker 已支持 `rerank_usage` 回传 | Python rerank 函数不输出 token usage 字段 | 需确认是 Node 侧自行记录还是确实需 Python 回传 |
| 3 | TopologyCanvas 通过 rAF→setTick 触发 React 每帧渲染 | rAF 循环直接操作 DOM 不触发 render，setTick 仅在拖拽时调用 | 性能热点是拖拽期间每像素 setState，非 rAF 导致重渲染 |

---

## 三、路线图未覆盖的 Critical 问题

### C1. XSS — markdown-renderer.tsx dangerouslySetInnerHTML

**文件：** `src/components/writing/markdown-renderer.tsx:38`  
**风险：** AI 生成内容通过 regex 转 HTML 后用 `dangerouslySetInnerHTML` 渲染，无转义。prompt injection 可注入 `<img src=x onerror=alert(1)>`  
**修复：** 用 React 元素替代 `dangerouslySetInnerHTML`，或加 DOMPurify

### C2. DoS — upload-image 无文件大小限制

**文件：** `src/app/api/v1/drafts/[id]/sections/[secId]/assets/upload-image/route.ts:40-55`  
**风险：** 客户端可上传任意大小文件，全部读入内存  
**修复：** 添加 `file.size` 检查，限制 10MB

### C3. 正确性 — compare 完成后状态仍为 "comparing"

**文件：** `src/app/api/v1/drafts/[id]/sections/[secId]/compare/route.ts:143`  
**风险：** 完成的比较和进行中的比较使用相同状态，stuck-section 检测会误标记已完成比较为卡住  
**修复：** 完成后使用 "reviewing" 或新增 "comparison_ready" 状态

### C4. 性能 — pipeline.ts embedding 后 N+1 重读

**文件：** `src/lib/documents/pipeline.ts:295-301`  
**风险：** 100 个 chunk = 200 次 DB 查询（写入 + 重读）  
**修复：** embedding 批处理时在内存中收集向量，直接写入 bin 文件

### C5. 安全 — fts.ts SQLite 变量数溢出

**文件：** `src/lib/search/fts.ts:49`  
**风险：** 500+ chunk 的文档会超出 SQLite 默认 SQLITE_MAX_VARIABLE_NUMBER (999)  
**修复：** 批量插入，每批 100-200

### C6. 正确性 — Python rag_query.py 缺失 send_dimensions

**文件：** `workers/python/rag_query.py:239-243`  
**风险：** index 和 manage 传 `send_dimensions=True`，query 不传，embedding 配置不一致  
**修复：** 添加 `send_dimensions=True` 匹配其他两个 worker

### C7. 正确性 — 维度启发式 4 个文件分歧

**文件：** `dimension.ts`、`rag_index.py`、`rag_query.py`、`rag_manage.py`  
**风险：** bge-m3 在 Node 侧返回 1024（匹配 `bge`），Python 侧返回 1536；text-embedding-3-large Python 返回 1536，Node 返回 3072  
**修复：** 统一到单一共享模块，优先使用 Node 侧 probe 的实际值

### C8. 安全 — export.py HTML 标题注入

**文件：** `workers/python/export.py:39,73-76`  
**风险：** markdown 标题直接插入 HTML `<title>` 标签，无转义  
**修复：** 使用 `html.escape()`

### C9. 安全 — confirm-asset 内容泄露到日志

**文件：** `src/app/api/v1/.../confirm-asset/route.ts:92`  
**风险：** `content.slice(0, 800)` 写入 stderr，日志聚合器可捕获敏感文档内容  
**修复：** 移除所有 content 日志，或引入 logger 的 redact 机制

### C10. 性能 — Python rag_manage.py N+1 图查询

**文件：** `workers/python/rag_manage.py:204-213`  
**风险：** 最多 30 次顺序 `get_knowledge_graph` 调用  
**修复：** 用 `asyncio.gather` 并发化

### C11. 正确性 — queue.ts 任务领取竞态

**文件：** `src/lib/queue/queue.ts:121-143`  
**风险：** `drain()` 并发调用 `processNext` 时，多个 worker 可领取同一任务  
**修复：** 用 `$transaction` 实现原子 claim

### C12. 正确性 — humanize wordCount 取自人性化前内容

**文件：** `src/app/api/v1/.../humanize/route.ts:74`  
**风险：** compare 模式下 wordCount 来自 `section.content`（非人性化后版本）  
**修复：** 从人性化后的 results 中计算

---

## 四、路线图已覆盖但审查补充细节的问题

| 路线图项 | 审查补充 |
|---------|---------|
| P0: resolveModel userId | ✅ 正确。补充：`resolveModel` 最终 fallback 是全表扫描（line 44），加 userId 后可 push filter 到 DB |
| P1: PUT providers 无 Zod | ✅ 正确。补充：mermaid-generate-code 是唯一完全不包 try/catch 的 route |
| P1: 裸 JSON.parse | ✅ 正确。补充：`generator.ts` fire-and-forget audit 中的 `JSON.parse(constraints)` 在无 try/catch 的 IIFE 中 |
| P1: SSE/asset marker 测试 | ✅ 正确。补充：`confirm-asset` 的 regex 跨 marker 匹配是潜在 bug |
| P1: Route 变薄 | ✅ 正确。补充：15 个 route 重复相同的 auth+ownership 模式（6-8 行），4 个 SSE route 重复 response headers |
| P2: 日志脱敏 | ✅ 正确。补充：LLM output 也被 log（mermaid-generate-code:67），需纳入 |
| P2: 前端拆分 | ✅ 正确。补充：`reference-panel.tsx` 731 行（最大组件）未在路线图列表中 |

---

## 五、路线图未覆盖的 Should-Fix 问题

### S1. Python worker 3x 重复样板代码
`fix_corrupted_json_files`、`load_storage_config`、`rerank_func` 在三个 RAG worker 中完全复制。应提取为 `rag_common.py`。

### S2. Python AsyncOpenAI 客户端资源泄漏
`rag_query.py:194-195` 的 `await client.close()` 和 `return ""` 不可达。重试循环内所有路径都 return 或 throw。

### S3. Python 可变默认参数
三个 worker 的 `llm_func` 都有 `history_messages: list = []`（Python 经典陷阱）。

### S4. Python 硬编码相对路径
三个 worker 使用 `os.path.join("data", "rag", user_id)`，依赖 CWD。

### S5. generator.ts 模型解析 3x 重复
`generateSectionFull`、`generateSectionStream`、compare 函数中模型解析逻辑完全复制。

### S6. estimateTokens 函数 2x 重复
`adapter.ts` 和 `splitter.ts` 中完全相同的实现。

### S7. provider-probe.ts N+1 HTTP 请求 + 冗余 models 列表获取
每个 model 都重新 GET `/models` 端点，但返回相同列表。

### S8. editor-panel.tsx 打字动画 3x 重复
三个 useEffect 块实现相同的 rAF 打字动画，应提取为 `useTypingAnimation` hook。

### S9. reference-panel.tsx 缺失 useMemo
`groupedReferences` IIFE 在每次 render 重算，即使 references 未变。

### S10. library/page.tsx 缺失 useMemo
6 个统计计算 + filterDocs 在每次 render 重算。

### S11. outline-panel.tsx 静默保存失败
`saveEditing` 的空 catch 块，outline 保存失败无任何用户反馈。

### S12. generate-image.ts 孤儿 pending 记录
Asset 在生成前创建，失败时无清理，长期积累 pending 记录。

### S13. drafts/[id] 重型查询重复
检测 stuck section 后完全重跑 12 行 include 的重型查询。

### S14. persist-references.ts 非事务 delete+insert
`deleteMany` 成功后 `createMany` 失败会丢失所有引用。

### S15. asset-pipeline.ts 顺序 DB 插入
逐条 `create` 而非 `createMany` 批量插入。

### S16. session.ts refresh token 不轮换
access token 过期后用 refresh token 认证但从不签发新 token。

### S17. convert.py 图片提取错误静默吞没
DOCX/PDF/PPTX 图片提取失败全被 `except Exception: pass` 吞掉。

### S18. Python JSON 失败静默返回空对象
`python.ts:44` 将无效 JSON 替换为 `{}`，mask 真实错误。

---

## 六、最终优化批次（修正路线图）

### Batch 0: 紧急安全修复（新增批次）

> 不改变用户可见功能，仅修补安全漏洞

**任务：**
1. 修 `markdown-renderer.tsx` XSS — 用 React 元素或 DOMPurify 替代 dangerouslySetInnerHTML
2. 修 `upload-image/route.ts` — 添加文件大小限制（10MB）
3. 修 `export.py` HTML 标题注入 — 加 `html.escape()`
4. 修 `confirm-asset/route.ts` — 移除 content 日志输出
5. 修 `mermaid-generate-code/route.ts` — 移除 LLM output 日志

**验证：** `pnpm lint && pnpm test:run && pnpm build`

---

### Batch 1: 恢复 Baseline（保持路线图原设计）

> 不改变用户可见功能

**任务：**
1. 修 `brainstorm/page.tsx` 文本转义
2. 修 `database-tab.tsx` render 阶段 `Math.random()`
3. 清理 unused import/vars/expression
4. 为 `*.log` 添加 gitignore

**验证：** `pnpm lint && pnpm test:run && pnpm build`

---

### Batch 2A: Provider PUT Schema + DTO 收敛（从原 Batch 2 拆出）

> 不改变 API envelope、SSE event、marker 格式

**任务：**
1. 提取共享 provider schema (`src/lib/models/provider-schema.ts`)
2. PUT route 使用 partial/update schema
3. 新增 `toModelConfigDto()`，DTO 显式列出允许字段
4. 修 `mermaid-generate-code/route.ts` — 加 try/catch 包 request.json()
5. 修 `brainstorm/sessions/[id]/message/route.ts` — 加 try/catch

**验证：**
- GET providers 不含 apiKey
- PUT 空 key 保留旧 key
- POST/PUT 保存 embeddingDim 和 passDimensions

---

### Batch 2B: resolveModel userId 改造（从原 Batch 2 拆出，独立验证）

> 影响全局模型解析，需独立验证

**任务：**
1. 改 `resolveModel(userId, capability)`
2. 更新 `createRagContext` 中所有调用点
3. 更新 writing/image/semantic/worker 入口

**兼容约束：** 保持原路线图的全部兼容约束

**验证：**
- 多用户模型解析测试
- 手动验证 embedding/search/generation

---

### Batch 3: Python Worker 协议对齐（修正路线图 Batch 3）

> **注意：** 路线图对 Python worker 的描述与代码不符，本批次先做事实对齐

**任务：**
1. 编写 Node-Python 实际协议文档（基于代码事实，非路线图描述）
2. 修 `rag_query.py` 添加 `send_dimensions=True`（C6）
3. 统一维度启发式到 `rag_common.py` 共享模块（C7）
4. 提取 `rag_common.py` 共享样板代码（S1）
5. 修 `rag_manage.py` N+1 图查询为并发（C10）
6. 修 `rag_query.py` AsyncOpenAI 资源泄漏（S2）
7. 修三个 worker 可变默认参数（S3）
8. 修 `python.ts` JSON 失败静默返回空对象（S18）
9. 修 `convert.py` 图片提取错误添加 stderr 日志（S17）

**验证：** `pnpm test:run && pnpm lint && pnpm build` + 手动验证 embedding/search

---

### Batch 4: SSE、Asset、JSON 测试保护（保持路线图原设计）

**任务：**
1. 补 SSE event tests
2. 补 marker parser/replace tests
3. 新增 `task-json.ts` parse helper + 替换高风险裸 `JSON.parse`
4. 新增 `section-metadata.ts` parse helper
5. 修 `generator.ts` audit IIFE 中裸 `JSON.parse` 加 try/catch
6. 修 `compare/route.ts` 完成状态区分（C3）
7. 修 `humanize/route.ts` wordCount 取自错误内容（C12）

**验证：** `pnpm test:run && pnpm lint && pnpm build`

---

### Batch 5: Route 变薄 + 共享 Helper（扩展路线图 Batch 5）

**任务：**
1. 提取 `requireDraftOwnership` / `requireSectionOwnership` 到 api-helpers（S13 关联）
2. 提取 `sseResponse()` 到 api-helpers
3. 抽 generate route 纯函数
4. 抽 token usage/audit best-effort helper
5. 抽 compare/confirm-asset/generate-image use-case
6. 修 `generate-image/route.ts` 失败时清理 orphaned pending asset（S12）
7. 修 `drafts/[id]/route.ts` stuck section 检测避免重查（S13）
8. 修 `persist-references.ts` 包事务（S14）
9. 修 `asset-pipeline.ts` 批量插入（S15）

**约束：** 不改 SSE event 协议、API envelope、marker 格式、DB schema

---

### Batch 6: 后端性能 + 安全加固（扩展路线图 Batch 6）

**任务：**
1. 修 `pipeline.ts` embedding N+1 重读（C4）
2. 修 `fts.ts` 批量插入防止变量溢出（C5）
3. 修 `queue.ts` 原子 claim（C11）
4. 修 `provider-probe.ts` 并发 HTTP + 去重 model list fetch（S7）
5. 提取 `generator.ts` 重复模型解析为 helper（S5）
6. 提取 `estimateTokens` 为共享模块（S6）
7. 新增 `src/lib/logger.ts` + 替换高风险 console
8. 修 Turbopack tracing warning

---

### Batch 7: 前端拆分 + 性能（扩展路线图 Batch 7）

**任务：**
1. 拆 `reference-panel.tsx`（731 行）→ `useImageGeneration` hook + `ImagePreviewModal` + ReferencePanel（新增，路线图遗漏的最大组件）
2. 拆 `editor-panel.tsx`（563 行）→ 提取 `useTypingAnimation` hook（S8）
3. 拆 `brainstorm/page.tsx` → session list / conversation / outline preview
4. 拆 `models-tabs.tsx` → provider CRUD / model list / usage analytics
5. 拆 `library/page.tsx` → search / batch / document table
6. 渐进拆 `writing/[id]`
7. 修 `reference-panel.tsx` groupedReferences 加 useMemo（S9）
8. 修 `library/page.tsx` 统计计算加 useMemo（S10）
9. 修 `outline-panel.tsx` saveEditing 添加错误反馈（S11）
10. 优化 TopologyCanvas — rAF 节流拖拽 + idle 时停止循环
11. 修 `database-tab.tsx` scrollbar CSS 移到 globals.css（暗色模式兼容）

---

## 七、全局计数

| 维度 | 路线图已覆盖 | 审查新增 | 总计 |
|------|------------|---------|------|
| Critical (安全/正确性) | 4 | 12 | 16 |
| High (可维护性) | 8 | 6 | 14 |
| Medium (性能/可读性) | 15 | 18 | 33 |
| Low (优化建议) | — | ~30 | ~30 |
| **总计** | **27** | **~66** | **~93** |

---

## 八、执行原则（保持路线图原有约束）

路线图的"功能保护执行约束"（§ 功能保护执行约束）、"核心契约"（§4）、"检查清单"（§7）、"验证矩阵"（§8）和"不做清单"（§9）全部保留，不做修改。所有新增批次同样受这些约束管辖。
