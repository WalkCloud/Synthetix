# 纯本地语义文档拆分架构：ONNX + bge-small-zh-v1.5

## 1. 设计目标

文档拆分阶段**零 LLM API 调用、零 Token 成本**。LLM 只保留给后端 LightRAG 实体抽取。拆分改为纯本地执行：Markdown AST 宏观阻断 + Chinese ONNX embedding 微观语义切分 + 面包屑上下文注入。

```
拆分阶段 (全部本地, ~5-8s CPU):
  sanitize → AST macro split → ONNX micro split → breadcrumb → safety guard

LightRAG 阶段 (LLM, graph worker 中, 不改):
  entity extraction → knowledge graph
```

## 2. 全链路流水线

```
document_convert worker
  |
  v
Phase 1: sanitize (Node, ~1ms)
  |-- 连续 3+ 个换行符压缩为双换行
  |-- 表格块标记为 atomic，不参与微观拆分
  |-- 剔除无业务意义的短图片占位符
  |
  v
Phase 2: macro AST split (Node, ~10ms)
  |-- 按 # (H1) / ## (H2) 物理阻断
  |-- 每块携带 metadata: { h1, h2, headingPath }
  |-- 表格/代码块作为 leaf atomic blocks
  |-- chunk 标题直接用 section heading，不调 LLM
  |
  v
Phase 3: local micro split (1 次 Python, ~4-6s)
  |-- Node 收集所有超限 macro chunk → 一次批量传给 Python
  |-- Python:
  |     1. 加载 ONNX bge-small-zh-v1.5 模型 (一次性, ~1-2s)
  |     2. encode all sentences → 512-dim vectors (~3ms/句)
  |     3. cosine similarity → 谷底检测 (sim < 0.55)
  |     4. jump-merge: 跳过孤立低相似度点 (约束 maxTokens)
  |     5. 返回每个 batch 的边界索引
  |-- Node 按边界组装 SplitChunk[]
  |
  v
Phase 4: breadcrumb inject (Node, ~0ms)
  |-- 每个 chunk 文本前拼接: [H1 > H2]
  |-- 传给 Python 的 maxTokens 预留 80 buffer 给面包屑
  |
  v
Phase 5: safety guard (Node, ~0ms)
  |-- enforceEmbeddingSafeChunks: 硬兜底，不应触发
  |
  v
Phase 6: persist + embed (现有, 不改)
```

## 3. 关键修正

### 3.1 批量处理消除 Spawn Trap

**错误做法**: 对每个 macro chunk 循环调用 `spawnPythonJson` → 100 次进程启动 + 100 次模型加载 = 50-150s 浪费。

**正确做法**: 收集所有超限 chunk 的句子，一次 Python 调用批量处理 → 1 次进程 + 1 次模型加载 = ~4-6s。

### 3.2 面包屑 Token Buffer 预留

传给 Python 的 `maxTokens` 减掉面包屑预留:

```ts
const BREADCRUMB_BUFFER = 80;
const safeMaxTokens = chunkMaxTokens - BREADCRUMB_BUFFER;
```

### 3.3 句子拆分防误切

正则 `(?<=[。！？.!?])(?=\s|$|[A-Z\u4e00-\u9fff])` 避免在 e.g. / v1.5 / Mr. 处误切。

### 3.4 Jump-Merge 硬性 Token 约束

即使相似度高、满足合并条件，只要 `seg_tokens >= maxTokens * 1.2` 就强制生成边界。

### 3.5 ONNX CPU Execution Provider

通过环境变量 `ORT_DISABLE_ALL=1` 显式禁用非 CPU EP，避免意外加载 GPU provider 导致启动慢。

## 4. 环境依赖

```
Python requirements.txt 追加:
  sentence-transformers>=4.0.0
  optimum[onnxruntime]>=1.20.0

模型文件:
  data/models/bge-small-zh-v1.5/  (gitignored)

环境变量:
  ORT_DISABLE_ALL=1
  LOCAL_EMBED_MODEL_PATH=data/models/bge-small-zh-v1.5
```

## 5. 文件清单

### 新增

```
src/lib/documents/outline/
  sanitize.ts       -- Phase 1: 防御性清洗
  sentences.ts      -- 中英文句子拆分 (防误切)
  macro-split.ts    -- Phase 2: H1/H2 宏观阻断
  micro-split.ts    -- Phase 3: 批量 Python ONNX 拆分
  breadcrumb.ts     -- Phase 4: 面包屑注入
  guard.ts          -- Phase 5: 安全阀门 (已有)

workers/python/
  local_chunk.py    -- ONNX 编码 + 相似度 + 边界检测 (批量入口)

src/__tests__/documents/outline/
  sanitize.test.ts
  sentences.test.ts
  macro-split.test.ts
  micro-split.test.ts
  breadcrumb.test.ts
```

### 修改

```
src/lib/documents/pipeline.ts      -- splitAndPersistChunks 接入新流水线
workers/python/requirements.txt    -- 追加 sentence-transformers, optimum
```

### 删除

```
src/lib/documents/outline/induction.ts       -- 旧 LLM 窗口分析
src/lib/documents/outline/segmentation.ts    -- 旧 LLM 拆分计划
src/__tests__/documents/outline/induction.test.ts
src/__tests__/documents/outline/segmentation.test.ts
```

## 6. 性能

| 指标 | 数值 |
|------|------|
| Python 进程 | 1 次/文档 |
| ONNX 模型加载 | ~1-2s (一次性) |
| 句子编码 | ~3ms/句 (CPU) |
| LLM API 调用 | 0 |
| LLM Token 消耗 | 0 |
| 84MB DOCX 总时间 | < 30s |

## 7. 验收标准

- [ ] 拆分阶段零 LLM API 调用、零 Token 成本
- [ ] 每个文档只 spawn 一次 Python 进程
- [ ] 不再出现 "Skipped embedding for X/Y chunks"
- [ ] 面包屑注入后 chunk 不触发 safety guard 硬拆分
- [ ] e.g. / v1.5 / Mr. 不触发误切
- [ ] jump-merge 合并后不超 maxTokens 约束
- [ ] ONNX 走 CPUExecutionProvider
- [ ] 中文 + 英文混合文档正确拆分
- [ ] 回归测试全绿
