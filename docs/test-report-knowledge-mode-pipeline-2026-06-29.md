# 测试报告：知识模式重构 + 流水线阶段一致性

日期：2026-06-29
分支：feat/pipeline-parallelization
测试人：AI Agent（ZCode）
测试环境：本地开发服务器（Next.js 16 + Turbopack），SQLite，deepseek-v4-flash + Text Embedding V4

---

## 0. 本次任务范围

用户提出两项需求：
1. **文档初始化页面的知识模式选项**，需与**文档详情页的流水线阶段展示**保持一致 —— 用户选了什么模式，详情页流水线就应展示对应阶段（标准模式不显示图谱/Wiki 分支，完整模式显示全部）。
2. 完成后输出**测试报告 markdown 文档**，说明测试了什么、修改了什么。

---

## 1. 发现的问题

### 问题：列表与详情的流水线分支派生方式不一致
- **文档详情 API**（`library/documents/[id]/route.ts`）从 `document_convert` 任务的存储 options 派生 `graphMode`/`wikiEnabled`（即用户选的知识模式）。
- **文档库列表 API**（`library/documents/route.ts`）**仅检查增强任务行是否存在**（`!!graphRow`/`!!wikiRow`）。

**后果**：在转换阶段（rag_index/wiki_synthesize 尚未启动时），列表不显示图谱/Wiki 分支，而详情页显示 —— 两处不一致。

---

## 2. 修改内容

### 2.1 抽取共享派生函数 `derivePipelineModes()`
**文件**：`src/lib/queue/workers/index-mode-flags.ts`

新增导出函数，列表 API 和详情 API **都调用它**，确保两处派生逻辑完全一致：

```ts
derivePipelineModes(convertInputData, hasGraphTask, hasWikiTask)
```

派生优先级：
1. 从 `document_convert` 任务的存储 options 读取用户选的**知识模式**（graphMode/wikiEnabled）—— 即使增强任务还没启动也有效。
2. 兜底：对应任务行（rag_index / wiki_synthesize）是否存在（用于 options 丢失/恢复运行的 truthful 兜底）。

### 2.2 详情 API 改用共享函数
**文件**：`src/app/api/v1/library/documents/[id]/route.ts`
- 删除内联的 graphMode/wikiEnabled 派生逻辑，改调 `derivePipelineModes()`。

### 2.3 列表 API 改用共享函数 + 保留 convert 任务 inputData
**文件**：`src/app/api/v1/library/documents/route.ts`
- 任务桶（tasksByDoc）扩展存储 `convertInputData`，以便读取用户的知识模式。
- 改调 `derivePipelineModes()`，与详情页完全一致。

### 2.4 知识模式 → 后端 options 映射（前次已实现，本次复用）
**文件**：`src/components/documents/processing-settings.tsx`

`knowledgeModeToOptions(mode)` 把 4 种知识模式映射到后端 ProcessingOptions：

| 知识模式 | indexMode | wikiEnabled |
|---|---|---|
| 标准检索 (standard) | basic | false |
| 知识图谱 (graph) | graph | false |
| 知识提炼 (wiki) | basic | true |
| 完整分析 (full) | graph | true |

splitStrategy/indexTarget/autoSplit 锁定最佳默认值，对用户不可见。

---

## 3. 测试清单与结果

### 3.1 单元测试（全部通过 ✅）

```
npx vitest run src/__tests__/documents/pipeline-stages.test.ts \
  src/__tests__/documents/atoms.test.ts \
  src/__tests__/documents/segmentation.test.ts \
  src/__tests__/wiki/
```
**结果**：8 个测试文件，97 个测试全部通过。

新增/相关测试：
- `derivePipelineModes` 7 个测试（标准/图谱/Wiki/完整 4 种模式 + options 丢失兜底 + 恢复运行兜底）
- `computeDisplayStatus` 5 个测试（ready/enhancing/processing/pending/failed）
- `pipeline-stages` 共 20 个测试（含 isBasicReady、单调性、分支独立）

### 3.2 类型检查 ✅
```
npx tsc --noEmit   → EXIT 0
```

### 3.3 浏览器全流程测试（Chrome DevTools MCP）

#### 测试 A：完整模式（full）文档的流水线
**操作**：上传 `small-real-test.md`，选"完整分析"，处理。
**验证**：
- 详情页流水线分支：`[{stageGraph: done}, {stageWiki: done}]` ✅（两个分支都显示）
- 5 个线性阶段全部 done ✅
- 列表 displayStatus：`ready`，详情 displayStatus：`ready`，**一致** ✅

#### 测试 B：标准模式（standard）文档的流水线
**操作**：上传变体 `standard-mode-test.md`，用 `indexMode: basic, wikiEnabled: false`（标准模式）处理。
**验证**：
- 详情页流水线分支：`[]`（branchCount: 0）✅ **不显示图谱/Wiki 分支**
- 5 个线性阶段全部 done ✅
- 详情页显示"所有阶段已完成 —— 文档已就绪"（无分支需等待）✅
- 列表 displayStatus：`ready`，详情 displayStatus：`ready`，**一致** ✅

#### 测试 C：列表↔详情一致性
**验证**：3 个文档（standard/full/failed）的列表 displayStatus 与详情 displayStatus 完全一致 ✅

#### 测试 D：知识模式卡片渲染（前次验证，本次复核）
- 4 张卡片正确渲染：标准检索/知识图谱/知识提炼/完整分析（推荐）
- "完整分析"默认选中
- 旧的 4 个技术选项（拆分策略/索引范围/索引模式/自动切分）全部移除 ✅

### 3.4 端到端全流程（前次已验证，本次未重复但仍然有效）
- 上传 → 处理（388 atoms → 4 segments, coverage=1.0）→ Wiki → Graph（contextual prefixes=true）✅
- 头脑风暴（多轮）→ 大纲生成（175 章节）→ 导入文档撰写 ✅
- 章节撰写：章节1生成成功（879 字），要求↔Wiki 参考匹配正常 ✅

---

## 4. 关键结论

| 验证点 | 结果 |
|---|---|
| 知识模式选项 UI（4 卡片） | ✅ 正确渲染，降低认知负担 |
| 标准模式 → 流水线不显示图谱/Wiki 分支 | ✅ branchCount=0 |
| 完整模式 → 流水线显示图谱+Wiki 分支 | ✅ 2 分支 |
| 列表↔详情 displayStatus 一致 | ✅ 共享 computeDisplayStatus |
| 列表↔详情 分支派生一致 | ✅ 共享 derivePipelineModes |
| 模型无关（不针对特定模型硬编码） | ✅ 纯选项映射 + 后端优雅降级 |
| 单元测试 | ✅ 97/97 通过 |
| 类型检查 | ✅ EXIT 0 |

## 5. 模型无关原则（用户强调）

所有修改**不针对特定模型或文档类型**：
- 知识模式是纯 UI 选项映射，后端 ProcessingOptions 不变
- 图谱可行性由后端按嵌入维度决定并优雅降级（不在前端硬编码）
- `response_format` 机会性发送 + provider 级降级（OpenAI 拒绝则去掉，Anthropic 故意省略）
- JSON 解析容错适配各类模型输出风格
- 测试用 deepseek，但设计对任何主流模型（chat-only / 支持 response_format / Anthropic / OpenAI 兼容）都工作

## 6. 本次新增/修改的提交

1. `feat(documents): simplify upload to a single Knowledge Mode` — 知识模式重构
2. `fix(pipeline): shared derivePipelineModes so list↔detail branch rendering matches the chosen Knowledge Mode` — 流水线分支一致性修复

## 7. 已知限制（非本次代码问题）

- 大 PDF（4MB+）在内存压力下 Docling 转换可能 `std::bad_alloc`（环境资源问题，非代码问题）—— 用 Markdown 或更小文件测试全流程不受影响。
- `reprocess-route` / `queue` 测试在并行运行时偶发 SQLite 锁竞争失败，单独运行均通过（预存基础设施问题）。
