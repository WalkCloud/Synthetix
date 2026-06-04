# 头脑风暴大纲问题 — 修正版根因分析与修复方案 (v2)

## 背景

之前的修复（调整 prompt、增加 maxTokens、状态清理）没有效果，因为它们只治标不治本。本方案基于对实际运行时数据流的深入追踪。

---

## 问题一：生成的大纲过于简单 — 真正的根因

### 两阶段流水线的瓶颈

大纲生成在 `src/lib/queue/workers/outline-worker.ts` 中有两个阶段：

**阶段A（汇总）** → 将整段对话压缩为 3-5 句话 + 扁平的章节列表  
**阶段B（生成）** → 基于这个稀薄的汇总来生成大纲 JSON

**根本问题：阶段A销毁了信息。** 一段包含详细需求、结构化初始大纲、逐章节细化讨论的 15 条消息对话，被压缩为：

1. `summaryText`：3-5 句话
2. `sectionsContext`：`"1. 章节标题 — 一行意图\n2. 章节标题 — 一行意图"` — 扁平的，没有层级
3. `constraintsContext`：大部分为空（所有字段都是"if mentioned/如有提及"）

阶段B的 LLM 用这碗稀汤来生成大纲，只能用通用的原型章节名来填充空白。结果就是一个看起来谁都能从原型骨架写出来的通用大纲。

### 阶段A中丢失的具体信息

| 收集到的信息 | 是否在汇总中丢失？ |
|---|---|
| 文档原型与目标 | ✅ 保留（3-5 句话） |
| 目标受众 | ❌ 仅当用户明确提及时 |
| 语气与风格偏好 | ❌ 仅当用户明确提及时 |
| 方向阶段的初始大纲（完整章节结构+描述） | ❌ 压缩为扁平的标题+意图列表 |
| 逐章节细化细节（角度、证据、边界） | ❌ 压缩为每章节 2-3 句意图 |
| 篇幅要求 | ⚠️ 保留为 `lengthHint` 字符串 |
| 上传文档中的事实 | ⚠️ 部分保留在 3-5 句话中 |

### 修复策略：将完整上下文传递给阶段B

不再依赖汇总作为阶段B的唯一输入，而是将**完整对话上下文**与汇总一起提供给阶段B的 LLM。汇总应该是指南，而不是唯一的信息来源。

### 具体改动

**A. 重写阶段B的用户消息，加入完整对话**（`outline-worker.ts:107-112`）

当前：
```ts
const userMessage = `Document requirement: ${summaryText}\n${sectionsContext}\nConstraints:\n${constraintsContext}\nGenerate the complete outline.`;
```

改为：将完整对话文本作为额外上下文加入，汇总作为结构化指南。这样阶段B可以直接访问方向阶段生成的初始大纲和所有用户需求。

**B. 扩展 confirmedSections 以保留层级结构**（`summary-prompt.ts`）

将 `confirmedSections` 格式改为包含可选的 `children` 和 `keyPoints`：
```json
{"title": "...", "intent": "...", "keyPoints": [...], "children": [...]}
```
这样可以保留方向阶段初始大纲的结构。

**C. 将约束提取改为强制推断，而非可选**（`summary-prompt.ts`）

修改 prompt：当字段未被明确提及时，要求 LLM 基于文档原型和对话上下文推断合理默认值。

**D. 将阶段B的 maxTokens 提升到 16384**（`outline-worker.ts`）

某些模型（GPT-4o）支持最多 16384 输出 token。8192 可能仍然限制非常详细的大纲。

---

## 问题二：点击重新生成按钮没反应 — 真正的根因

### 发现了 5 个 Bug

### Bug 1（严重）：API 失败时静默无操作

**文件：** `src/hooks/brainstorm/use-brainstorm-outline.ts:164-179`

```typescript
async function clearOutline() {
    if (!activeId || loading) return;
    ...
    try {
      const res = await fetch(...);
      const d = await res.json();
      if (d.success) { setOutline(null); ... }  // ← 没有 else 分支！
    } finally { setLoading(false); }
}
```

如果 API 返回 `{success: false}`（认证过期、404、服务器错误），代码静默地什么都不做。没有错误消息，没有控制台警告，没有状态变化。用户可以反复点击，毫无效果。

**修复：** 添加 `else` 分支，显示用户可见的错误反馈。

### Bug 2（严重）：没有 catch 块 — `res.json()` 异常被吞掉

同一个函数。如果 `res.json()` 抛出异常（HTML 错误页、网络故障），执行直接跳到 `finally`。`setOutline(null)` 永远不会被调用。大纲静默地保留。

**修复：** 添加 `catch` 块，包含错误处理和用户反馈。

### Bug 3（严重）：竞态条件 — 正在进行的轮询会恢复已清除的大纲

**文件：** `src/hooks/brainstorm/use-brainstorm-outline.ts:81-133`

`resetPolling()` 调用 `stopPolling()`，但 `stopPolling()` 只取消**待执行**的 `setTimeout` 轮询（通过 `clearTimeout`）。它**不会中止**正在进行的 `fetch` 请求。一个在 `clearOutline` 将大纲设为 null **之后**才完成的前一个轮询，会调用 `setOutline(generatedOutline)` 和 `setPhase("ready")`，立即恢复旧大纲。

`poll()` 函数在完成时**从不检查** `pollingTaskIdRef.current`。它盲目地更新状态。

**修复：** 在 `poll()` 回调中，调用 `setOutline`/`setPhase` 之前检查 `pollingTaskIdRef.current === taskId`。如果不匹配，说明该轮询已被取代——丢弃结果。

### Bug 4（高）：服务端 — 正在运行的 worker 会覆盖已清除的大纲

**文件：** `src/lib/queue/queue.ts:102-123` 和 `outline-worker.ts:153-154`

`queue.cancel()` 只更新数据库状态。它**不会中断**正在运行的 worker。Worker 继续执行到完成，在 `executeTask` 的取消检查**之前**就将 `outline` 写入会话（`db.brainstormSession.update`）。这会覆盖 `clearOutline` 设置的 null。

**修复：** 在大纲 worker 中，写入数据库之前检查任务状态。如果已取消，跳过数据库写入并提前返回。

### Bug 5（中）：重新生成按钮只清除，不重新生成

按钮标签是"重新生成"，但只调用了 `clearOutline()`。清除后，用户必须重新走完整个对话流程。标签和行为不匹配。

**修复：** `clearOutline()` 成功后，自动调用 `generateOutline()` 基于现有对话历史重新生成。或者将按钮重命名为"清除大纲"，并添加一个独立的"重新生成"按钮来清除+重新生成。

---

## 修复方案

### 阶段A：修复问题二（重新生成按钮）— 这些是阻塞性 bug

**文件1：`src/hooks/brainstorm/use-brainstorm-outline.ts`**

1. 修复 `clearOutline()`：
   - 当 `!d.success` 时添加 `else` 分支：显示错误反馈
   - 添加 `catch` 块：记录错误、显示用户反馈、确保状态重置
   - 成功后自动调用 `generateOutline()`，使按钮真正实现"重新生成"

2. 修复 `poll()` 中的竞态条件：
   - 在调用 `setOutline`/`setPhase`/`setStatus` 之前，验证 `pollingTaskIdRef.current === taskId`
   - 如果不匹配，丢弃结果（该轮询已被 `clearOutline` 取代）

**文件2：`src/lib/queue/workers/outline-worker.ts`**

3. 在写入数据库之前添加取消检查：
   - 在 `db.brainstormSession.update`（第153行）和 `db.message.create`（第165行）之前，检查异步任务是否已被取消
   - 如果已取消，提前返回，不写入

**文件3：`src/app/api/v1/brainstorm/sessions/[id]/route.ts`**

4. 已完成（取消任务、清理消息）。保持现状。

### 阶段B：修复问题一（大纲过于简单）

**文件4：`src/lib/queue/workers/outline-worker.ts`**

5. 重写阶段B用户消息构建（第107-112行）：
   - 将完整对话文本作为额外上下文加入
   - 格式：先放结构化汇总指南，然后 "## 完整对话上下文" 加上对话内容
   - 这样阶段B可以直接访问方向阶段的初始大纲

**文件5：`src/lib/brainstorm/summary-prompt.ts`**

6. 扩展 `confirmedSections` 格式以包含层级：
   - 添加可选的 `children` 字段和 `keyPoints` 字段
   - 同时更新中英文 prompt

7. 将约束提取改为主动推断：
   - 将"如有提及/if mentioned"改为"未明确说明时根据对话上下文推断"
   - 确保阶段B始终有语气、深度、受众等指导信息

**文件6：`src/lib/brainstorm/outline-prompt.ts`**

8. 之前的改动（深度指导、目标章节数）是好的，保留。
   - 更新 prompt，告诉 LLM 使用"完整对话上下文"部分获取详细需求。

**文件7：`src/lib/queue/workers/outline-worker.ts`**

9. 将 `maxTokens` 从 8192 提升到 16384。

---

## 涉及文件（最终列表）

| 优先级 | 文件 | 改动内容 |
|--------|------|----------|
| P0 | `src/hooks/brainstorm/use-brainstorm-outline.ts` | 修复 `clearOutline` 错误处理+catch；修复轮询竞态条件；清除后自动重新生成 |
| P0 | `src/lib/queue/workers/outline-worker.ts` | 数据库写入前添加取消检查；重写阶段B用户消息包含完整对话；maxTokens 升至 16384 |
| P1 | `src/lib/brainstorm/summary-prompt.ts` | 扩展 `confirmedSections` 包含层级+keyPoints；约束改为主动推断 |
| P1 | `src/lib/brainstorm/outline-prompt.ts` | 更新 prompt 引用"完整对话上下文" |

## 验证方法

1. **问题二修复验证：**
   - 生成大纲 → 点击"重新生成" → 验证大纲清除且新生成自动开始
   - 验证没有竞态条件导致旧大纲恢复
   - 检查 server.log 是否有流程中的错误
   - 运行 `npx vitest run src/__tests__/brainstorm/` — 27 个测试必须全部通过

2. **问题一修复验证：**
   - 创建新会话，提供详细需求
   - 生成大纲 → 验证：2-3 层层级、章节包含对话中的具体细节（不仅是通用原型名称）、`keyPoints` 有意义、`writingRequirements` 针对具体章节
   - 同时测试 `general` 和 `technical_solution` 原型
   - 前后对比：新大纲应清晰反映对话中才有的细节

3. **完整回归检查：**
   - 运行完整测试套件：`npx vitest run`
   - 类型检查：`npx tsc --noEmit`
