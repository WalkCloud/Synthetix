# 头脑风暴大纲生成与重新生成修复设计

> 日期：2026-06-04  
> 范围：头脑风暴页面右侧 outline 卡片、大纲生成 pipeline、异步任务匹配、大纲质量控制  
> 目标：修复“生成的大纲过于简单”和“右侧重新生成无反应”两个用户可见问题

---

## 一、背景

当前头脑风暴页面已经完成两阶段大纲生成改造：

```text
头脑风暴对话 -> 结构化摘要 -> 轻量大纲 prompt -> 大纲 JSON -> 保存到 session
```

这个设计原本用于降低大纲生成延迟，但实际使用中出现两个回归：

1. 生成的大纲明显偏简单，常见表现是只有少量一级标题，缺少 2-3 层结构和可直接写作的叶子章节。
2. 右侧 outline 卡片点击“重新生成”后没有开始新一轮生成，用户感觉按钮无反应。

本设计文档定义最终修复方案，作为后续实现和验收依据。

---

## 二、问题诊断

### 2.1 右侧“重新生成”没有触发生成

当前右侧按钮位于：

```text
src/app/(dashboard)/brainstorm/page.tsx
```

按钮绑定的是：

```tsx
onClick={outline.clearOutline}
```

而 `clearOutline()` 位于：

```text
src/hooks/brainstorm/use-brainstorm-outline.ts
```

实际行为是：

```text
停止轮询 -> 清空本地 task id -> PATCH clearOutline -> 清空 session.outline -> phase = gathering -> 结束
```

它不会调用：

```text
POST /api/v1/brainstorm/sessions/:id/generate-outline
```

也不会提交新的 `outline_generate` 异步任务。

因此，“重新生成”按钮当前语义实际是“清空大纲并回到头脑风暴初始状态”。这和按钮文案不一致。

### 2.2 清空后进入无操作状态

`clearOutline()` 成功后设置：

```ts
setPhase("gathering")
```

右侧面板在无 outline 且 phase 为 `gathering` 时进入普通预览占位分支，而不是生成中、重试、模式选择。

结果：

```text
用户点击重新生成 -> 旧大纲消失或状态变化不明显 -> 没有新任务 -> 右侧无继续操作按钮
```

### 2.3 清空失败时没有用户可见反馈

`clearOutline()` 当前只处理 `d.success === true` 的路径。

如果 API 返回：

```json
{ "success": false }
```

当前代码没有 `else` 分支，不会显示错误，不会记录明确失败，也不会改变 outline 状态。用户看到的就是“点了没反应”。

同时，如果 `fetch()` 或 `res.json()` 抛出异常，函数也没有 `catch` 块，最终只会执行 `finally { setLoading(false); }`。旧大纲仍保留，用户没有任何反馈。

这不是重新生成按钮语义问题，而是错误处理缺失导致的静默失败。

### 2.4 前端轮询竞态会恢复旧大纲

`resetPolling()` 能取消尚未执行的 `setTimeout`，但不能中止已经发出去的 `/api/v1/tasks/:taskId` 请求。

可能出现以下竞态：

```text
旧 poll fetch 已发出
用户点击重新生成
resetPolling() 将 pollingTaskIdRef.current 清空
clearOutline() 将 outline 置空
旧 poll fetch 返回 completed
旧 poll 继续 setOutline(generatedOutline)
旧大纲被恢复
```

当前 `poll()` 在调用 `setOutline()`、`setStatus()`、`setPhase()` 前没有检查：

```ts
pollingTaskIdRef.current === taskId
```

因此被取代的旧轮询仍然可能写入 UI 状态。

### 2.5 后端 worker 取消后仍可能写库

服务端 `queue.cancel()` 只是把 task 状态更新为 `cancelled`，不会中断正在运行的 worker。

当前 queue 的取消检查发生在 worker 返回之后，但 outline worker 在返回前已经写入：

```text
brainstormSession.outline
outline ready system message
```

可能出现以下竞态：

```text
outline worker 正在运行
用户点击重新生成
clearOutline() cancel 旧 task，并将 session.outline = null
旧 worker 完成生成
旧 worker 写入 brainstormSession.outline
queue 之后才发现 task 已 cancelled
旧大纲覆盖 null 或新状态
```

所以仅取消 task 不够，outline worker 自己也必须在写库前检查当前 task 是否已取消。

### 2.6 大纲生成上下文被过度压缩

当前 worker 位于：

```text
src/lib/queue/workers/outline-worker.ts
```

它先调用：

```text
src/lib/brainstorm/summary-prompt.ts
```

生成一个 3-5 句的需求摘要，然后 outline 阶段只使用这个摘要和少量 constraints。

这会丢失头脑风暴对话中的章节细节、用户确认过的方向、模块、证据要求、边界和篇幅要求。

实际风险：

```text
用户聊了很多 -> summary 只保留少量抽象句子 -> outline 阶段只能生成通用骨架
```

### 2.7 summary 解析失败会退化为空需求

当前 summary 解析失败时，worker 使用空 fallback：

```ts
{
  archetype: "general",
  secondaryArchetype: null,
  summary: "",
  confirmedSections: [],
  constraints: {},
}
```

这会导致 outline 阶段接近于收到：

```text
Document requirement:

Generate the complete outline.
```

模型只能生成泛化大纲。

### 2.8 大纲质量没有硬门槛

`src/lib/brainstorm/outline-prompt.ts` 已经要求：

```text
2-3 层级、4-8 个一级章节、15-30 个叶子章节
```

但 `src/lib/brainstorm/outline-normalizer.ts` 只校验：

```text
必须有 title
sections 必须是数组
至少有一个 section
```

因此，以下结构也会被接受并保存：

```json
{
  "title": "方案",
  "sections": [
    { "title": "背景" },
    { "title": "目标" },
    { "title": "实施计划" }
  ]
}
```

### 2.9 异步任务匹配存在误匹配风险

生成和清空 route 当前通过以下方式查找任务：

```ts
inputData: { contains: id }
```

这是字符串子串匹配，不是结构化匹配。

风险包括：

1. 某个任务的其他字段包含同样字符串，被误认为当前 session 的任务。
2. 清空当前 session 时误取消其他 session 的任务。
3. 生成 route 返回错误的 existing task，前端轮询错误任务，用户感觉生成无响应。

---

## 三、修复目标

### 3.1 用户体验目标

点击右侧“重新生成”后，用户应看到：

```text
旧大纲清空 -> 右侧立即进入生成中 -> 新任务开始 -> 新大纲出现
```

失败时应看到：

```text
生成失败提示 -> retry 按钮可用
```

不能出现：

```text
按钮点击后只是清空大纲
按钮点击后没有新任务
按钮点击后回到无操作 preview 占位
API 失败或网络异常时静默无反馈
旧轮询或旧 worker 把已清空的大纲恢复回来
```

### 3.2 大纲质量目标

标准文档生成的大纲应满足：

1. 一级章节数量通常为 4-8 个。
2. 至少 2 层结构。
3. 标准篇幅文档至少 10 个叶子章节。
4. 长篇文档至少 15 个叶子章节。
5. 叶子章节具备 `description`、`keyPoints`、`estimatedWords`。
6. 不再保存只有几个一级标题的浅层大纲。

### 3.3 工程目标

1. 不修改数据库 schema。
2. 不修改 LLM provider 抽象。
3. 不重构队列核心。
4. 修复集中在 brainstorm outline 生成链路。
5. 每个核心行为都有测试覆盖。

---

## 四、目标架构

### 4.1 重新生成链路

```text
用户点击重新生成
  -> regenerateOutline()
  -> 停止旧轮询
  -> 标记旧 task 结果不可再写入 UI
  -> PATCH clearOutline
  -> 服务端取消当前 session 的旧 outline task
  -> 服务端清空旧 outline
  -> 本地 outline = null
  -> phase = ready
  -> isGeneratingOutline = true
  -> POST generate-outline
  -> startPolling(taskId)
  -> task completed
  -> setOutline(newOutline)
```

竞态防护：

```text
前端：poll 返回时必须确认 pollingTaskIdRef.current === taskId，否则丢弃结果
后端：worker 写 brainstormSession.outline 前必须确认 task 未 cancelled，否则提前返回
```

### 4.2 大纲生成链路

```text
Phase A: 结构化需求摘要
  输入：完整头脑风暴对话
  输出：archetype、confirmedStructure、keyTopics、constraints、mustInclude、mustAvoid

Phase B: 大纲生成
  输入：结构化摘要 + 对话关键摘录 + 单个 archetype 骨架
  输出：outline JSON

Phase C: 规范化
  normalizeGeneratedOutline()

Phase D: 质量评估
  evaluateOutlineQuality()

Phase E: 低质量重试
  如果第一次 outline 太浅，携带具体失败原因重试一次

Phase F: 保存
  只有通过质量门槛的大纲才保存到 brainstormSession.outline
```

---

## 五、详细设计

### 5.1 新增 `regenerateOutline()`

修改文件：

```text
src/hooks/brainstorm/use-brainstorm-outline.ts
```

新增函数：

```ts
async function regenerateOutline() {
  if (!activeId || loading) return;

  resetPolling();
  setOutlineTaskId(null);
  setOutline(null);
  setPhase("ready");
  setIsGeneratingOutline(true);
  setLoading(true);

  try {
    const clearRes = await fetch(`/api/v1/brainstorm/sessions/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clearOutline" }),
    });
    const clearData = await clearRes.json();
    if (!clearData.success) throw new Error("Failed to clear outline");

    const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/generate-outline`, {
      method: "POST",
      headers: { "x-locale": locale },
    });
    const d = await res.json();

    if (d.success && d.data?.taskId) {
      startPolling(d.data.taskId);
      return;
    }

    throw new Error("Failed to start outline generation");
  } catch {
    setIsGeneratingOutline(false);
    setLoading(false);
    setPhase("ready");
  }
}
```

返回值中暴露：

```ts
regenerateOutline
```

同时修复 `clearOutline()` 的错误处理：

```text
API 返回 success:false -> 设置失败状态或用户可见错误提示，不能静默忽略
fetch/res.json 抛异常 -> catch 中记录错误并恢复 loading
finally -> 只负责释放 loading，不吞掉失败语义
```

如果当前项目还没有 toast/error banner，可先用轻量状态字段，例如：

```ts
const [outlineError, setOutlineError] = useState<string | null>(null);
```

并在右侧失败分支展示该错误。不要只 `console.warn`。

### 5.2 修复前端轮询竞态

修改文件：

```text
src/hooks/brainstorm/use-brainstorm-outline.ts
```

在 `poll()` 读取 task 并准备写 UI 状态前，增加 task id 校验：

```ts
if (pollingTaskIdRef.current !== taskId) {
  return;
}
```

该检查至少放在以下状态写入之前：

```ts
setOutline(generatedOutline);
setStatus(t.brainstorm.status.complete);
setPhase("ready");
setSessions(...);
setIsGeneratingOutline(false);
setLoading(false);
```

目标是丢弃已经被 `resetPolling()` 或新一轮 `startPolling()` 取代的旧请求结果。

### 5.3 右侧按钮改用 `regenerateOutline()`

修改文件：

```text
src/app/(dashboard)/brainstorm/page.tsx
```

将：

```tsx
<button onClick={outline.clearOutline} disabled={sess.loading || !sess.outline}
```

改为：

```tsx
<button onClick={outline.regenerateOutline} disabled={sess.loading || !sess.outline}
```

按钮文案保持“重新生成”。

### 5.4 精确匹配 outline task

新增工具函数，建议文件：

```text
src/lib/brainstorm/task-matching.ts
```

内容：

```ts
export function taskMatchesSession(inputData: string | null, sessionId: string): boolean {
  if (!inputData) return false;
  try {
    const parsed = JSON.parse(inputData) as { sessionId?: unknown };
    return parsed.sessionId === sessionId;
  } catch {
    return false;
  }
}
```

修改文件：

```text
src/app/api/v1/brainstorm/sessions/[id]/generate-outline/route.ts
```

查找 existing task 时：

1. 先查询当前用户 pending/running 的 `outline_generate` 任务。
2. 用 `taskMatchesSession(task.inputData, id)` 精确过滤。
3. 找到 existing task 时调用 `getQueue()`，确保 queue 初始化。
4. 返回 existing task id。

修改文件：

```text
src/app/api/v1/brainstorm/sessions/[id]/route.ts
```

`clearOutline` 取消任务时也使用 `taskMatchesSession()`，只取消当前 session 的任务。

### 5.5 worker 写库前检查取消状态

修改文件：

```text
src/lib/queue/workers/outline-worker.ts
```

新增 helper：

```ts
async function isTaskCancelled(taskId: string): Promise<boolean> {
  const task = await db.asyncTask.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  return task?.status === "cancelled";
}
```

在写入 session outline 前检查：

```ts
if (await isTaskCancelled(taskId)) {
  return { cancelled: true };
}

await db.brainstormSession.update({
  where: { id: sessionId },
  data: { outline: JSON.stringify(outline), title: outline.title || session.title },
});
```

在创建 outline ready 系统消息前再次检查，避免取消后留下误导性系统消息：

```ts
if (await isTaskCancelled(taskId)) {
  return { cancelled: true };
}

await db.message.create({
  data: { sessionId, role: "system", content: messages.outlineReady },
});
```

这样即使 queue 不能中断正在运行的 worker，旧 worker 也不会覆盖已清空或新生成中的 session 状态。

### 5.6 扩展 summary schema

修改文件：

```text
src/lib/brainstorm/summary-prompt.ts
```

目标 schema：

```json
{
  "archetype": "primary archetype identifier",
  "secondaryArchetype": "secondary archetype identifier if hybrid document, else null",
  "documentPurpose": "document goal and real-world use",
  "targetAudience": "target readers and decision makers",
  "requiredScope": ["scope item that must be covered"],
  "confirmedStructure": [
    {
      "title": "confirmed section or major direction",
      "intent": "what this part should accomplish",
      "details": ["specific point, module, evidence, or boundary"]
    }
  ],
  "keyTopics": ["specific modules, analysis dimensions, objects, phases, risks, evidence groups"],
  "constraints": {
    "tone": "desired writing tone if mentioned",
    "depth": "expected depth level if mentioned",
    "lengthHint": "overall length expectation if mentioned",
    "audience": "target audience if mentioned",
    "boundaries": ["what to emphasize or avoid"]
  },
  "mustInclude": ["non-negotiable content"],
  "mustAvoid": ["content to avoid"],
  "summary": "backward-compatible concise summary",
  "confirmedSections": [
    { "title": "legacy confirmed section title", "intent": "legacy section intent" }
  ]
}
```

中文 prompt 同步更新。

### 5.7 outline 阶段增加对话关键上下文

修改文件：

```text
src/lib/queue/workers/outline-worker.ts
```

新增对话摘录：

```ts
const conversationContext = conversation.length > 20_000
  ? conversation.slice(-20_000)
  : conversation;
```

构造 `userMessage` 时包含：

1. 结构化 summary。
2. confirmedStructure。
3. keyTopics。
4. constraints。
5. mustInclude / mustAvoid。
6. conversationContext。

这样 outline 阶段不仅依赖抽象摘要，还能看到用户最终确认的细节。

### 5.8 summary 解析失败不允许空 fallback

修改文件：

```text
src/lib/queue/workers/outline-worker.ts
```

当前逻辑：

```text
summary 解析失败 -> general + 空 summary -> 继续生成
```

目标逻辑：

```text
summary 解析失败 -> 重试一次 summary -> 仍失败则 throw -> task failed -> UI retry
```

这能避免保存泛化大纲。

### 5.9 新增大纲质量评估

新增文件：

```text
src/lib/brainstorm/outline-quality.ts
```

接口：

```ts
import type { GeneratedOutline } from "@/lib/brainstorm/outline-normalizer";
import type { OutlineSection } from "@/lib/outline-tree";

export interface OutlineQualityOptions {
  minLeafCount?: number;
  minDepth?: number;
  minTopLevelCount?: number;
  maxTopLevelCount?: number;
}

export interface OutlineQualityResult {
  ok: boolean;
  leafCount: number;
  maxDepth: number;
  topLevelCount: number;
  totalEstimatedWords: number;
  issues: string[];
}
```

默认规则：

```text
minTopLevelCount = 4
maxTopLevelCount = 8
minDepth = 2
minLeafCount = 8
```

根据篇幅动态提高 leaf 要求：

```text
2,000-3,000 字：minLeafCount = 8
5,000-8,000 字：minLeafCount = 10
10,000+ 字：minLeafCount = 15
```

质量失败示例：

```text
leafCount < minLeafCount
maxDepth < minDepth
topLevelCount < minTopLevelCount
topLevelCount > maxTopLevelCount
leaf section 缺少 description
leaf section 缺少 keyPoints
```

### 5.10 低质量大纲重试一次

修改文件：

```text
src/lib/queue/workers/outline-worker.ts
```

流程：

```text
generate outline
  -> normalize
  -> evaluate quality
  -> ok: 保存
  -> not ok: 带 issues 重试一次
  -> retry ok: 保存
  -> retry not ok: throw
```

重试反馈示例：

```text
The previous outline is too shallow and cannot be saved.

Quality issues:
- Leaf sections: 5, expected at least 12
- Max depth: 1, expected at least 2
- 4 leaf sections are missing keyPoints

Regenerate the complete outline. Keep the same JSON schema. Use 2-3 levels of hierarchy and create meaningful child sections for modules, phases, analysis dimensions, risks, deliverables, and evidence groups.
```

### 5.11 normalizer 支持常见 children alias

修改文件：

```text
src/lib/brainstorm/outline-normalizer.ts
```

新增：

```ts
function getRawChildren(raw: Record<string, unknown>): unknown[] | undefined {
  const candidates = [raw.children, raw.subsections, raw.subSections, raw.items, raw.chapters];
  const found = candidates.find(Array.isArray);
  return Array.isArray(found) ? found : undefined;
}
```

将原本只读取 `raw.children` 的逻辑替换为 `getRawChildren(raw)`。

### 5.12 dotted number 层级重建改为两遍

修改文件：

```text
src/lib/brainstorm/outline-normalizer.ts
```

目标：

1. child 出现在 parent 前面时仍能挂载。
2. flat dotted outline 能稳定转树。
3. mixed format 不应明显丢失层级。

设计：

```text
第一遍：所有 section 按 num 放入 map
第二遍：根据 parentNum 寻找 parent
  有 parent -> 挂到 parent.children
  无 parent -> roots
最后 renumberOutlineSections(roots)
```

---

## 六、测试设计

### 6.1 `task-matching.test.ts`

文件：

```text
src/__tests__/brainstorm/task-matching.test.ts
```

测试点：

```ts
import { describe, expect, it } from "vitest";
import { taskMatchesSession } from "@/lib/brainstorm/task-matching";

describe("taskMatchesSession", () => {
  it("matches exact sessionId", () => {
    expect(taskMatchesSession(JSON.stringify({ sessionId: "abc" }), "abc")).toBe(true);
  });

  it("does not match substring from another field", () => {
    expect(taskMatchesSession(JSON.stringify({ sessionId: "def", note: "abc" }), "abc")).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    expect(taskMatchesSession("{bad json", "abc")).toBe(false);
  });

  it("returns false for null input", () => {
    expect(taskMatchesSession(null, "abc")).toBe(false);
  });
});
```

### 6.2 `outline-quality.test.ts`

文件：

```text
src/__tests__/brainstorm/outline-quality.test.ts
```

测试点：

1. 只有 3 个一级标题的大纲不通过。
2. 2 层结构、足够 leaf 的大纲通过。
3. 长篇 lengthHint 会提高 leaf 要求。
4. 缺少 keyPoints 的 leaf 会产生 issue。

### 6.3 `outline-normalizer.test.ts`

扩展文件：

```text
src/__tests__/brainstorm/outline-normalizer.test.ts
```

新增测试点：

1. `subsections` 会被识别为 children。
2. `subSections` 会被识别为 children。
3. child-before-parent dotted numbers 能重建层级。
4. mixed dotted format 不丢失明显子章节。

### 6.4 `outline-prompt.test.ts`

扩展文件：

```text
src/__tests__/brainstorm/outline-prompt.test.ts
```

新增测试点：

1. summary prompt 包含 `confirmedStructure`。
2. summary prompt 包含 `keyTopics`。
3. summary prompt 包含 `mustInclude` 和 `mustAvoid`。
4. 中文 summary prompt 同步包含这些字段。

### 6.5 前端轮询竞态测试

如果当前 hook 测试成本较高，至少将轮询结果应用逻辑提取成可测 helper，覆盖以下行为：

```text
当前 pollingTaskIdRef.current 与返回 taskId 一致 -> 允许 setOutline
当前 pollingTaskIdRef.current 为 null -> 丢弃旧结果
当前 pollingTaskIdRef.current 是新 taskId -> 丢弃旧 task 结果
```

该测试防止“重新生成后旧 poll 恢复旧大纲”的回归。

### 6.6 worker 取消写库测试

为 `outline-worker.ts` 或新增 helper 补测试，覆盖：

```text
task 在生成完成前变为 cancelled -> 不调用 brainstormSession.update
task 在写 outline 后、写系统消息前变为 cancelled -> 不创建 outline ready message
task 未 cancelled -> 正常写 outline 和系统消息
```

该测试防止“服务端旧 worker 覆盖已清空大纲”的回归。

---

## 七、验证方案

### 7.1 自动化验证

优先运行：

```bash
npm test -- src/__tests__/brainstorm/task-matching.test.ts
```

```bash
npm test -- src/__tests__/brainstorm/outline-quality.test.ts
```

```bash
npm test -- src/__tests__/brainstorm/outline-normalizer.test.ts
```

```bash
npm test -- src/__tests__/brainstorm/outline-prompt.test.ts
```

然后运行：

```bash
npm test
```

```bash
npm run build
```

如果当前环境使用 `pnpm`，则替换为：

```bash
pnpm test
```

```bash
pnpm build
```

### 7.2 手动验证

场景 1：直接生成

```text
新建头脑风暴 session
输入一个技术方案需求
选择直接生成完整大纲
观察右侧进入生成中
生成完成后检查大纲深度
```

验收：

```text
至少 2 层结构
不少于 8 个 leaf sections
不是只有一级标题
```

场景 2：右侧重新生成

```text
已有 outline 后点击右侧“重新生成”
```

验收：

```text
旧大纲消失
右侧立即显示生成中
后端出现新的或当前 session 精确匹配的 outline_generate task
完成后显示新大纲
```

场景 3：生成失败

```text
临时断开模型服务或使用错误模型配置
点击重新生成
```

验收：

```text
任务失败后 UI 停止 loading
右侧出现 retry 状态
不会卡死在生成中
不会保存空泛大纲
```

场景 4：长篇文档

```text
用户明确要求 10,000 字以上报告
生成大纲
```

验收：

```text
leaf sections 通常不少于 15
estimatedWords 总量接近篇幅要求
章节有明确父子关系
```

---

## 八、实施顺序

### P0：修复重新生成主链路

1. 新增 `regenerateOutline()`。
2. 右侧按钮改为调用 `regenerateOutline()`。
3. `clearOutline()` 和 `regenerateOutline()` 都必须处理 `success:false` 和网络/JSON 异常。
4. 保证失败后进入 retry 分支，并给用户可见错误反馈。

### P0：修复重新生成竞态

1. 前端 `poll()` 写 UI 前校验 `pollingTaskIdRef.current === taskId`。
2. 被取代的旧轮询结果必须直接丢弃。
3. 后端 `outline-worker.ts` 写 `brainstormSession.outline` 前检查 task 是否已取消。
4. 后端创建 outline ready 系统消息前再次检查 task 是否已取消。

### P0：修复 task 精确匹配

1. 新增 `taskMatchesSession()`。
2. generate route 精确查找 existing task。
3. clear route 精确取消当前 session task。
4. 添加单元测试。

### P1：修复 summary 过度压缩

1. 扩展 summary schema。
2. outline userMessage 加入结构化字段和对话关键摘录。
3. summary 解析失败改为重试或失败，不再空 fallback。

### P1：增加大纲质量门槛

1. 新增 `outline-quality.ts`。
2. worker 中生成后质量评估。
3. 低质量时重试一次。
4. 第二次仍低质量则任务失败。

### P2：增强 normalizer 容错

1. 支持 children alias。
2. dotted number 层级重建改为两遍。
3. 补充 normalizer 测试。

### P2：提升大纲输出 token 上限

1. 在模型/provider 支持时，将 outline 阶段 `maxTokens` 从 `8192` 提升到 `16384`。
2. 不把该项作为唯一质量修复；它只能减少长 JSON 被压缩或截断的概率。
3. 如果 provider 对 `16384` 不兼容，需要保留失败可见性或降级策略，不能静默保存短大纲。

---

## 九、风险与取舍

### 9.1 质量门槛可能导致更多任务失败

这是可接受的。

保存低质量大纲比失败更差，因为用户会基于错误结构继续写作。失败后可 retry，低质量保存后用户需要人工返工。

### 9.2 prompt 输入会变长

这是必要取舍。

上一轮优化过度追求 token 降低，导致上下文不足。本次只追加最后 20,000 字符对话摘录，不恢复旧巨型 archetype prompt，避免完全回退性能优化。

### 9.3 重试会增加少量延迟

只有低质量大纲才重试。正常情况仍是两阶段生成。

### 9.4 maxTokens 提升不是根因修复

将 outline 阶段 `maxTokens` 提升到 16384 可以降低长 JSON 被模型压缩或截断的概率，但它不能替代质量门槛。

如果没有 `evaluateOutlineQuality()`，模型仍可能在更高 token 上限下输出浅层大纲。因此 token 上限提升只能作为 P2 辅助项。

### 9.5 不做数据库迁移

outline 仍以 JSON 字符串保存，兼容旧数据。

---

## 十、完成标准

本修复完成后，应满足：

1. 点击右侧“重新生成”会真正启动新生成任务。
2. 重新生成过程中 UI 有明确 loading 状态。
3. 失败时 UI 可重试，不会卡死。
4. 旧轮询结果不会在重新生成后恢复旧大纲。
5. 已取消的旧 worker 不会再写入 `brainstormSession.outline` 或 outline ready 系统消息。
6. 异步任务匹配不再依赖字符串 contains。
7. summary 解析失败不会继续生成空泛大纲。
8. 大纲质量不达标不会被保存。
9. 标准场景下生成的大纲具备 2 层以上结构和足够 leaf sections。
10. 自动化测试覆盖 task matching、outline quality、normalizer alias、summary prompt schema、轮询竞态、worker 取消写库。
11. `npm test` 和 `npm run build` 通过。

---

## 十一、关联文件清单

### 必改文件

```text
src/app/(dashboard)/brainstorm/page.tsx
src/hooks/brainstorm/use-brainstorm-outline.ts
src/app/api/v1/brainstorm/sessions/[id]/generate-outline/route.ts
src/app/api/v1/brainstorm/sessions/[id]/route.ts
src/lib/queue/workers/outline-worker.ts
src/lib/brainstorm/summary-prompt.ts
src/lib/brainstorm/outline-normalizer.ts
```

### 新增文件

```text
src/lib/brainstorm/task-matching.ts
src/lib/brainstorm/outline-quality.ts
src/__tests__/brainstorm/task-matching.test.ts
src/__tests__/brainstorm/outline-quality.test.ts
src/__tests__/brainstorm/outline-regeneration-race.test.ts
```

### 可能修改文件

```text
src/__tests__/brainstorm/outline-prompt.test.ts
src/__tests__/brainstorm/outline-normalizer.test.ts
```

---

## 十二、后续优化

本次修复只解决当前回归。后续可以继续优化：

1. 在任务进度中展示“已识别文档类型”“正在扩展章节结构”“正在质量检查”。
2. 将质量评估结果记录到 task result，便于排查模型输出问题。
3. 对不同 archetype 设置不同 leaf section 下限。
4. 将用户选择的初始大纲方向结构化保存，而不是仅存在聊天文本中。
5. 为重新生成提供选项：保留原方向重新生成、重新头脑风暴、只优化当前大纲。
