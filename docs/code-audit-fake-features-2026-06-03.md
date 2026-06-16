# Synthetix 代码审计：假功能 / 硬编码 / 静默成功

> 日期：2026-06-03  
> 范围：全量代码库静态审查，重点覆盖前端页面、API 路由、队列 worker、RAG/LightRAG、LLM 适配器、写作与审计模块  
> 目的：识别“看起来成功但核心逻辑未执行”、硬编码回退、静默失败、未接线能力和 mock/placeholder 风险  
> 状态：最终审计文档；仅记录问题，未修改运行时代码

---

## 一、最终结论

代码库没有发现传统意义上的“假数据页面”：没有 mock 用户列表、假统计数组、Lorem ipsum 生产内容、静态假仪表盘等。大部分前端数据来自真实 API 和数据库。

真正的问题集中在更隐蔽的模式：**失败被包装成成功、核心能力失败后继续显示 ready/completed、或 fallback 生成看似可用的结果**。这会让用户无法区分：

- 系统真实完成了工作；
- 系统跳过了关键逻辑；
- 外部模型/RAG/审计失败，但被空结果、满分或 ready 状态掩盖。

本次最终确认的问题如下：

| 级别 | 数量 | 重点风险 |
| --- | ---: | --- |
| Critical | 2 | 加密回退密钥公开；审计未执行却返回满分 |
| High | 6 | 假大纲；RAG/LightRAG 失败被隐藏；知识图谱错误按成功返回；维度猜测；未注册任务类型 |
| Medium | 8 | userId 日志泄露；DB 配置失败回退 SQLite；token 计量粗估；Python 默认参数；硬编码图片 fallback；语义搜索空结果 |
| Low / 代码质量 | 5 | 空 catch、UX 延迟、探测字符串、启动日志、颜色映射分散 |

---

## 二、对原审计结论的修正

原文档的方向基本正确，但有几处需要收紧表述：

| 编号 | 最终判断 | 修正说明 |
| --- | --- | --- |
| C1 | 成立 | 硬编码加密回退密钥是安全问题，保持 Critical |
| C2 | 成立但需补充 | `auditor.ts` 仅“无 client”返回满分；实际 LLM 调用异常会返回失败。`audit.ts` 解析失败/无 JSON 返回满分仍成立 |
| H2 | 成立但降级 | 图片 fallback 硬编码模型名会浪费请求并误导配置策略，但最终资产会标记 failed，不是伪成功 |
| H4 | 成立但表述修正 | 未注册任务会被队列标记 failed，不是伪成功；风险是类型/API 合约允许提交必失败任务 |
| M6 | 成立但分类调整 | 静态 salt 是安全硬化问题，不属于假功能主线 |
| M7 / L2 / L3 / L5 | 降级 | 启动日志、800ms UX 延迟、`"test"` 探测、颜色映射分散不是假功能，只作为代码质量项记录 |

---

## 三、Critical 级别

### C1. 数据库配置密码使用硬编码回退加密密钥

**文件：** `src/lib/settings/db-config.ts:18,27`

```ts
const key = process.env.ENCRYPTION_KEY || "fallback-key-32-chars--";
```

**问题：** 当 `ENCRYPTION_KEY` 未设置时，PostgreSQL 密码使用公开硬编码字符串加密。任何能读源码的人都可复现密钥并解密存储密码。

**对比：** 主加密模块 `src/lib/crypto.ts` 缺少 `ENCRYPTION_KEY` 会抛出 fatal error，但 `db-config.ts` 静默回退，安全行为不一致。

**影响：** 生产环境遗漏环境变量时，加密形同虚设且没有告警。

**建议：** 删除 fallback key；缺少 `ENCRYPTION_KEY` 时直接抛错。数据库配置加密应复用 `src/lib/crypto.ts`。

---

### C2. 审计系统未执行或解析失败时返回“满分通过”

**文件：** `src/lib/writing/auditor.ts:13-19`、`src/lib/writing/audit.ts:85,114`

```ts
// auditor.ts: 没有可用写作模型
return { passed: true, score: 100, issues: [], checkedAt: new Date().toISOString() };

// audit.ts: 无 JSON 或 JSON 解析失败
return { passed: true, score: 100, issues: [], checkedAt: new Date().toISOString() };
```

**问题：** 以下场景会被伪装成完美审计：

- 未配置写作模型，审计直接跳过；
- LLM 返回内容没有 JSON；
- LLM 返回非法 JSON。

**影响：** 用户看到“审计通过 / 100 分”，但实际质量检查可能从未执行。

**建议：** 审计不可用时返回失败结果，例如 `passed: false, score: 0, issues: [{ rule: "audit_unavailable", severity: "critical", ... }]`。不要把解析失败当作“无问题”。

---

## 四、High 级别

### H1. 大纲生成解析失败后写入硬编码单节大纲

**文件：** `src/lib/queue/workers/outline-worker.ts:63-66`

```ts
const outline = jsonMatch ? JSON.parse(jsonMatch[0]) : {
  title: session.title,
  sections: [{ num: "1", title: "Introduction", keyPoints: [], estimatedWords: 500 }],
};
```

**问题：** LLM 输出无法解析时，系统生成一个只含 `Introduction` 的大纲，并继续写入 brainstorm session。

**影响：** 用户无法区分“AI 生成的大纲”和“解析失败后的硬编码兜底”。这是明确的伪成功。

**建议：** 解析失败应让任务失败，或至少写入 `fallback: true` / `parseError` 并在前端显示重试提示。

---

### H2. LightRAG 索引失败被隐藏，文档仍显示 ready/completed

**文件：** `src/lib/documents/pipeline.ts:366-376`、`src/lib/queue/index.ts:23-31`、`src/lib/queue/queue.ts:239-241`、`src/lib/queue/workers/document-worker.ts:117-121`

```ts
const indexResult = await indexWithLightRAG(...).catch((err) => {
  console.warn("LightRAG indexing failed (non-blocking):", err);
  return { status: "failed", chunks: 0, error: String(err) };
});

// document_convert worker
await processDocument(taskId);
return { ok: true };
```

**问题：** `indexDocument()` 会把 LightRAG 失败写入 `resultData`，但外层队列随后用 worker 返回的 `{ ok: true }` 覆盖任务结果，并把任务标记 `completed`。文档也会被标记为 `ready`。

**影响：** 用户看到“文档处理完成”，但语义索引/图谱索引可能失败。后续搜索和知识图谱缺结果时，用户很难定位原因。

**建议：**

- 不要覆盖 `pipeline.ts` 写入的索引结果；
- 如果 LightRAG 是配置启用的核心能力，索引失败应进入 `failed` 或 `ready_with_index_error`；
- 文档状态和任务结果应保留 `rag.status` / `rag.error` 并在 UI 暴露。

---

### H3. 知识图谱 API 把 worker 错误包装成成功响应

**文件：** `src/app/api/v1/knowledge/graph/route.ts:33`、`src/app/api/v1/knowledge/entities/route.ts:28`、`src/app/api/v1/knowledge/entities/[name]/route.ts:37`、`src/app/api/v1/knowledge/manage/route.ts:61`、`workers/python/rag_manage.py:90,98,109,117,125,154,208,331`

```ts
const result = await manageRag(...);
return successResponse(result);
```

Python worker 多处返回：

```py
return {"error": str(e)}
```

**问题：** `manageRag()` 返回 `{ error: "..." }` 时，API 仍使用 `successResponse(result)`。HTTP/API envelope 变成 `success: true`，错误只藏在 data 内层。

**影响：** 前端或调用方可能认为图谱查询、实体 CRUD、merge/delete 操作成功，实际 worker 已失败。

**建议：** API 层检测 `result.error`，转为 `errorResponse(result.error, 500)` 或结构化业务错误。

---

### H4. 本地/无 API key 模型会导致 RAG context 构建失败，语义搜索静默空结果

**文件：** `src/lib/rag/context.ts:22-29,56-58`、`src/lib/search/semantic.ts:146-151`

```ts
apiKey: decrypt(model.provider.apiKey || ""),
```

```ts
try {
  ctx = await createRagContext(userId);
} catch {
  return [];
}
```

**问题：** 本地 provider（如 Ollama）通常没有 API key。`buildEmbedConfig()` 对空字符串调用 `decrypt("")`，会触发加密模块错误。随后 `semanticSearch()` 捕获错误并返回 `[]`。

**影响：** 语义搜索会表现为“无结果”，实际原因可能是 RAG context 构建失败。

**建议：** `buildEmbedConfig()` 对空 key 返回空字符串或 provider-specific 默认值；`semanticSearch()` 不应把初始化失败伪装成无结果。

---

### H5. 嵌入维度探测失败后靠模型名猜测

**文件：** `src/lib/rag/dimension.ts:55-70`、`workers/python/rag_common.py:114-131`、`workers/python/rag_index.py:107-117`

```ts
if (modelLower.includes("mxbai") || modelLower.includes("nomic")) return 768;
return 768;
```

**问题：** API 探测失败后使用字符串启发式和默认 768。猜错会导致向量维度与存储/LightRAG 配置不匹配。

**补充：** 原文“重复 3 处”需要精确化：当前是 TypeScript 一处、Python shared 一处、`rag_index.py` 内联一处。`rag_query.py` / `rag_manage.py` 已调用 `rag_common.resolve_embed_dim()`。

**建议：** 维度未知时失败并提示用户测试/保存 embeddingDim，而不是默认 768。`rag_index.py` 应复用 `rag_common.resolve_embed_dim()`。

---

### H6. 任务类型定义与实际 worker 注册不一致

**文件：** `src/lib/queue/types.ts:2-8`、`src/lib/queue/index.ts:23,33,54`、`src/lib/queue/queue.ts:170-176`

定义了 7 种任务：

```ts
"document_upload" | "document_convert" | "rag_index" |
"chapter_generate" | "chapter_summarize" |
"outline_generate" | "draft_generate_all"
```

实际注册 3 种：

- `document_convert`
- `draft_generate_all`
- `outline_generate`

**问题：** `document_upload`、`rag_index`、`chapter_generate`、`chapter_summarize` 是未接线类型。队列执行时会标记为 failed，不是伪成功；但类型/API 合约允许提交必失败任务。

**建议：** 删除死类型，或注册对应 worker；`submit()` 前校验 worker 是否存在。

---

## 五、Medium 级别

### M1. 调试日志泄露 userId 和业务 ID

**文件：** `src/app/api/v1/drafts/[id]/sections/[secId]/unlock/route.ts:19`、`src/app/api/v1/drafts/[id]/sections/[secId]/assets/route.ts:19`

```ts
console.log("[unlock] params:", { draftId, sectionId, userId: user.id });
console.log("[assets] params:", { draftId, sectionId, userId: user.id });
```

**风险：** 每次请求输出用户 ID、draft ID、section ID。生产日志中会保留敏感业务关系。

**建议：** 删除或改为受环境变量控制的 debug 日志，并避免输出 userId。

---

### M2. 语义搜索初始化失败返回空结果

**文件：** `src/lib/search/semantic.ts:146-151`

```ts
try {
  ctx = await createRagContext(userId);
} catch {
  return [];
}
```

**问题：** 无模型、解密失败、配置错误都会显示为“无搜索结果”。

**建议：** 返回结构化错误，或在 API 层显示“语义搜索不可用”。普通“无匹配”和“搜索系统故障”必须区分。

---

### M3. 数据库配置读取失败会静默回退 SQLite dev.db

**文件：** `src/lib/settings/db-config.ts:38-49`、`src/lib/db.ts:21`

```ts
} catch {
  return null;
}

url: process.env.DATABASE_URL || "file:./dev.db",
```

**问题：** PostgreSQL 配置损坏、密码无法解密、配置文件读取失败时，`readDbGlobalConfig()` 返回 `null`，主 DB 初始化会回退到 `file:./dev.db`。

**影响：** 生产或演示环境可能悄悄连到 SQLite，造成“数据消失”或写入错误数据库。

**建议：** 如果检测到数据库配置文件存在但读取失败，应抛错，而不是回退。生产环境缺少 DB 配置也应 fail fast。

---

### M4. 图片生成 fallback 盲目尝试硬编码模型名

**文件：** `src/lib/writing/image-generator.ts:169-183`

```ts
const fallbackCandidates = ["dall-e-3", "gpt-image-2", "flux-1", "wanx-v3"];
```

**问题：** 配置模型失败或非 image capable 时，系统固定尝试 4 个模型名。对 Ollama、DashScope、私有 OpenAI-compatible 服务，这些模型名大概率无效。

**说明：** 这不是伪成功；最终会把资产标记 failed。但它会制造额外请求、延迟和误导性日志。

**建议：** 只从用户已配置且具备 `image_generation` capability 的模型里选择 fallback。

---

### M5. Token 用量使用长度粗估

**文件：** `src/lib/llm/adapter.ts:30-36`

```ts
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1.5));
}
```

**问题：** 当 provider 不返回 usage 时，用字符长度估算 token。中文、代码、混合文本误差较大。

**影响：** 用量统计和成本估算不可靠。

**建议：** 使用 tokenizer 库；或在 UI 明确标记为 estimated usage。

---

### M6. Python RAG worker 默认参数不安全

**文件：** `workers/python/rag_index.py`、`workers/python/rag_query.py`、`workers/python/rag_manage.py`

典型默认值：

```py
--embed-api-base default="http://localhost:11434/v1"
--embed-api-key default="ollama"
--llm-api-key default="ollama" / ""
```

**问题：** 参数遗漏时会静默连接本地 Ollama 或发送字面量 `ollama` 作为 API key。

**影响：** 独立运行 worker 或主应用未传参时，可能连错后端。

**建议：** 主应用调用路径强制传入配置；独立 CLI 参数对非本地模式使用 `required=True` 或显式 `--local-ollama`。

---

### M7. 静态 scrypt salt

**文件：** `src/lib/crypto.ts:20`

```ts
return scryptSync(process.env.ENCRYPTION_KEY, "synthetix-salt", KEY_LENGTH);
```

**问题：** 所有实例共用同一 salt。虽然不是“假功能”，但削弱密钥派生隔离性。

**建议：** 使用 per-installation salt 并持久化，或明确当前威胁模型下接受该风险。

---

### M8. Windows 默认 Python 命令可能不可用

**文件：** `src/lib/python.ts:8`、`src/lib/rag/client.ts:5`、`src/lib/writing/export-pipeline.ts:11`

```ts
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";
```

**问题：** Windows 常见命令是 `python`，未设置 `PYTHON_PATH` 时 worker/export/RAG 可能失败。

**建议：** `process.platform === "win32" ? "python" : "python3"`，或启动时检测并提示。

---

## 六、Low / 代码质量项

### L1. 广泛空 catch 和静默吞噬错误

扫描发现多处 `catch {}` / `.catch(() => {})`。其中部分是合理的非阻塞清理或 SSE 关闭保护，但仍建议分级处理。

典型位置：

- 前端 hooks：`src/hooks/writing/use-section-actions.ts`、`src/hooks/writing/use-generation.ts`
- 模型管理 UI：`src/components/models/models-tabs.tsx`
- RAG 维度缓存：`src/lib/rag/dimension.ts`
- 文档清理：`src/app/api/v1/documents/[id]/route.ts`、`src/app/api/v1/documents/batch/route.ts`
- 图表 JSON 修复：`src/lib/writing/diagram-translate.ts`
- 导出临时文件清理：`src/lib/writing/export-pipeline.ts`

**建议：** 非阻塞错误至少 `console.warn`；用户可见操作失败必须反馈 UI。

---

### L2. Provider 连接测试最小 800ms 延迟

**文件：** `src/components/models/models-tabs.tsx:96`

```ts
if (elapsed < 800) await new Promise((r) => setTimeout(r, 800 - elapsed));
```

**判断：** UX 节流，不是假功能。

---

### L3. 嵌入端点探测使用 `"test"` 模型名

**文件：** `src/lib/llm/adapter.ts:225`、`src/lib/llm/provider-probe.ts:38`

```ts
body: JSON.stringify({ input: "test", model: "test" })
```

**判断：** 功能上可用于探测端点存在，但对严格 provider 不够准确。

---

### L4. 启动日志

**文件：** `src/instrumentation.ts:6`

```ts
console.log("[queue] Task queue initialized");
```

**判断：** 普通运行日志，不是假功能。可按日志规范调整。

---

### L5. Topology 颜色映射分散

**文件：** `src/components/topology/topology-canvas.tsx`、`src/components/topology/topology-detail-panel.tsx`、`src/components/topology/topology-legend.tsx`

**判断：** 维护性问题，不是假功能。

**建议：** 抽到共享常量。

---

## 七、未发现传统假数据页面

全库扫描 `mock`、`dummy`、`fake`、`stub`、`placeholder`、`Lorem ipsum` 后，未发现生产页面使用静态假列表或假统计数据。

出现的 placeholder 主要属于以下正常用途：

- 输入框 placeholder；
- 导出图片不可用时的占位；
- 写作资产生成前的 “chart/image pending” 文案；
- 测试文件中的 mock。

这些不构成“假功能页面”。

---

## 八、修复优先级

### P0：立即修复

| 编号 | 修复动作 |
| --- | --- |
| C1 | 删除 `db-config.ts` fallback key；缺少 `ENCRYPTION_KEY` 直接失败 |
| C2 | 审计不可用/解析失败返回失败结果，不允许满分通过 |
| H1 | 大纲解析失败不写入硬编码 `Introduction`；任务失败或显示 fallback 状态 |
| H2 | LightRAG 索引失败不能被 `{ ok: true }` 覆盖；文档状态保留索引错误 |
| H3 | 知识图谱 API 检测 `result.error` 并返回错误响应 |
| H4 | 修复本地 provider 空 API key 解密问题；语义搜索初始化失败不返回空结果 |

### P1：短期修复

| 编号 | 修复动作 |
| --- | --- |
| H5 | embedding 维度未知时提示用户测试/保存，不默认 768 |
| H6 | 删除未注册任务类型，或补齐 worker；提交前校验 |
| M1 | 删除 userId 调试日志 |
| M3 | DB 配置文件存在但读取失败时 fail fast |
| M4 | 图片 fallback 从用户已配置 image 模型选择 |
| M6 | Python worker 默认参数改为显式本地模式或必传 |

### P2：长期改进

| 编号 | 修复动作 |
| --- | --- |
| M5 | 引入 tokenizer 或标记 estimated usage |
| M7 | 引入 per-installation salt |
| M8 | Windows Python 命令自适应 |
| L1 | 梳理空 catch：清理型保留，用户可见型必须反馈 |
| L5 | Topology 颜色常量集中管理 |

---

## 九、与 v0.10.4 优化计划的关系

本文发现的问题与 `docs/final-optimization-plan-2026-06-03.md` 的优化批次属于不同层次：

| 维度 | v0.10.4 优化重点 | 本文新增/确认重点 |
| --- | --- | --- |
| 安全 | XSS、DoS、日志泄露 | 回退加密密钥、静态 salt、userId 调试日志 |
| 正确性 | 状态机、DTO、API 一致性 | 审计满分、假大纲、RAG 错误即成功 |
| 可靠性 | worker、批量插入、N+1 | LightRAG 索引失败隐藏、维度猜测、Python 默认参数 |
| 用户体验 | UI 状态、加载反馈 | 区分“无结果”和“系统不可用” |

建议将 P0/P1 项作为 v0.10.5 的独立修复批次执行。
