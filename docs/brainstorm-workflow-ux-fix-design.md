# 头脑风暴流程体验修复设计

> 日期：2026-06-17  
> 范围：头脑风暴需求梳理、最后篇幅确认、可确认大纲生成、A/B 生成方式选择  
> 目标：修复“篇幅/字数混在前几轮问题里”和“逐章确认后突然给出总结但没有明确下一步”的用户体验问题

---

## 一、背景

当前头脑风暴功能通过多阶段对话帮助用户生成文档大纲：

```text
需求梳理 -> 大纲方向选择 -> 生成方式选择 -> 逐章细化或直接生成 -> 大纲生成
```

实际使用中出现两个明显体验问题：

1. 系统可能把文档篇幅、字数或页数混在前几轮结构问题里，导致用户还没完成核心结构思考时就被打断。
2. 在逐章细化模式下，用户回答完全部章节后，AI 可能只给出一段类似“核心结构需求已全部明确”的总结，但没有明确告诉用户下一步该做什么，也没有稳定地引导用户生成最终大纲。

这两个问题都会破坏头脑风暴流程的确定性：用户不知道当前处在哪一步，也不知道系统是否已经准备好进入生成。

---

## 二、问题诊断

### 2.1 篇幅要求被混入前几轮问题

当前篇幅相关逻辑主要位于：

```text
src/lib/brainstorm/length-requirement.ts
src/app/api/v1/brainstorm/sessions/[id]/message/route.ts
src/lib/prompts/skills/index.ts
```

现有 prompt 在需求梳理阶段只要求：

```text
期望篇幅、字数、页数或格式（仅在当前轮次自然适合时询问）
```

这会让模型在前几轮结构梳理时就混问篇幅，或者在需求还没梳理完整时提前结束。正确体验应该是：先问完目标、受众、范围、核心内容等结构需求，最后单独问篇幅/字数，然后基于所有信息形成可确认大纲。

### 2.2 篇幅检测会误判 AI 提问为用户已确认

`conversationHasLengthRequirement()` 当前扫描整段对话：

```ts
messages.some((message, index) =>
  hasExplicitLengthRequirement(message.content)
  || isOptionReplyToPreviousLengthQuestion(message, messages[index - 1])
)
```

`hasExplicitLengthRequirement()` 不区分消息角色。只要 AI 自己问过“你期望这份文档的大致篇幅是多少”，就可能被判断为“对话中已有篇幅要求”。

正确语义应该是：

```text
只有用户明确提供篇幅、字数、页数、格式，或用户对 AI 的篇幅问题作出 A/B/C/D 选择，才算完成篇幅确认。
```

### 2.3 逐章确认完成后缺少显式下一步

当前逐章细化 prompt 要求：

```text
所有章节确认后，追加：
ALL_SECTIONS_CONFIRMED
```

前端处理逻辑位于：

```text
src/app/(dashboard)/brainstorm/page.tsx
```

现有行为是：

```ts
case "ALL_SECTIONS_CONFIRMED":
  sess.setPhase("ready");
  generateOutline();
  break;
```

也就是说，只要模型追加 `ALL_SECTIONS_CONFIRMED`，前端就直接开始生成大纲。这个自动行为有两个问题：

1. 聊天区缺少明确的用户指令，例如“请点击右侧按钮生成完整大纲”。
2. 如果模型回复只是在总结需求，用户会感觉流程突然结束或突然跳转。

### 2.4 ready 状态语义混乱

当前 `ready` 同时承担多种含义：

```text
准备生成
正在等待生成结果
生成失败后的重试状态
已有大纲后的可写作状态
```

这会让右侧面板在没有 outline 时显示“生成失败”类 UI，即使真实状态只是“需求已确认，等待用户触发生成”。

---

## 三、修复目标

### 3.1 篇幅作为最后一个独立问题

需求梳理阶段的最后一问，必须单独确认以下任一信息：

```text
篇幅
字数
页数
格式要求
简版 / 标准版 / 完整版
```

如果用户尚未提供，系统不得形成可确认大纲；如果用户已经主动提供过篇幅，则不重复询问。

### 3.2 下一步必须明确

逐章细化全部完成后，系统必须明确告诉用户：

```text
所有章节需求已经确认。
下一步可以生成完整大纲。
```

此时不自动生成大纲，而是等待用户点击明确按钮。

### 3.3 状态必须可解释

前端需要区分：

```text
section_refine：仍在逐章细化
ready_to_generate：需求已确认，等待用户点击生成
ready：已进入生成或已有大纲后的状态
```

用户在任何时刻都应该能从聊天区或右侧面板看出下一步动作。

---

## 四、设计方案

### 4.1 修正篇幅检测语义

修改：

```text
src/lib/brainstorm/length-requirement.ts
```

目标行为：

```text
用户消息中出现明确篇幅/字数/页数/格式 -> true
用户在 AI 篇幅问题后回复 A/B/C/D -> true
AI 消息中出现“篇幅/字数/页数” -> false
用户对非篇幅问题回复 A/B/C/D -> false
```

建议新增函数：

```ts
function userProvidedExplicitLengthRequirement(message: BrainstormMessageLike): boolean {
  if (message.role && message.role !== "user") return false;
  return hasExplicitLengthRequirement(message.content);
}
```

然后将 `conversationHasLengthRequirement()` 调整为只接受用户侧确认。

### 4.2 在 gathering 阶段增加最后篇幅问题硬门槛

修改：

```text
src/app/api/v1/brainstorm/sessions/[id]/message/route.ts
```

当前只在 direction 阶段拦截：

```ts
if (phase === "direction" && marker === "DIRECTION_CONFIRMED" && !conversationHasLengthRequirement(history)) {
  effectiveMarker = null;
  effectiveContent = buildLengthRequirementQuestion(locale);
}
```

需要增加 gathering 阶段拦截：

```text
如果 phase === "gathering"
且 marker === "NEEDS_GATHERED"
且 conversationHasLengthRequirement(history) === false
则不返回 NEEDS_GATHERED
改为返回篇幅确认问题
```

这样即使模型想提前结束需求梳理，服务端也会先插入最后一个独立篇幅问题，而不是直接进入 direction。

### 4.3 调整 discovery prompt

修改：

```text
src/lib/prompts/skills/index.ts
```

将需求梳理阶段的篇幅规则从：

```text
期望篇幅、字数、页数或格式（仅在当前轮次自然适合时询问）
```

改为：

```text
不要把篇幅/字数/页数和其他结构问题混在同一轮询问。
先问完非篇幅结构问题；当其他需求已清楚时，最后一个独立问题只问篇幅。
提出最后篇幅问题时不要追加 NEEDS_GATHERED。
```

英文 prompt 同步调整，避免中英文行为不一致。

### 4.4 回答最后篇幅问题后直接生成可确认大纲

新增纯函数：

```text
src/lib/brainstorm/phase-routing.ts
```

目标行为：

```text
如果当前 phase 是 gathering
且上一条 AI 消息是篇幅问题
且当前用户消息回答了篇幅或选择 A/B/C/D
则本轮 prompt 直接使用 direction
```

这样用户回答最后篇幅问题后，AI 不再继续普通需求梳理，而是直接输出一个可确认的初始大纲，并保留原有 A/B 生成方式选择。

### 4.5 新增 ready_to_generate 阶段

修改类型定义：

```text
src/hooks/brainstorm/types.ts
src/app/api/v1/brainstorm/sessions/[id]/message/route.ts
src/lib/prompts/builders/facilitator.ts
```

新增 phase：

```ts
type Phase = "gathering" | "direction" | "mode_select" | "section_refine" | "ready_to_generate" | "ready";
```

`ready_to_generate` 表示：

```text
需求已经确认完成
还没有开始生成最终大纲
等待用户显式点击生成按钮
```

### 4.6 修改 ALL_SECTIONS_CONFIRMED 的前端处理

修改：

```text
src/app/(dashboard)/brainstorm/page.tsx
```

将：

```ts
case "ALL_SECTIONS_CONFIRMED":
  sess.setPhase("ready");
  generateOutline();
  break;
```

改为：

```ts
case "ALL_SECTIONS_CONFIRMED":
  sess.setPhase("ready_to_generate");
  sess.setLoading(false);
  break;
```

这样逐章确认完成后不会突然开始生成。

### 4.7 增加显式生成入口

在右侧 outline 面板中增加 `ready_to_generate` 分支：

```text
标题：章节需求已确认
说明：可以基于已确认的结构和篇幅生成完整大纲。
按钮：生成完整大纲
```

按钮调用现有：

```ts
outline.generateOutline()
```

聊天区也可以显示一个轻量提示条：

```text
所有章节需求已确认，请点击右侧“生成完整大纲”继续。
```

### 4.8 支持用户文字触发生成

修改：

```text
src/hooks/brainstorm/use-brainstorm-chat.ts
```

当前 `inferModeSelectClientMarker()` 只在 `mode_select` 阶段识别 A/B。

建议扩展为：

```text
ready_to_generate 阶段：
用户输入 “生成”、“开始生成”、“生成完整大纲”、“A” 等
识别为 GENERATE_DIRECT
```

这样用户既可以点按钮，也可以直接在聊天框里说“生成”。

---

## 五、目标交互流程

### 5.1 正常梳理流程

```text
用户说明文档主题
AI 询问目标、受众、范围、核心内容
AI 最后单独确认篇幅
用户选择标准版 / 完整版 / 自定义字数
AI 形成一个可确认初始大纲
用户选择 A 直接生成，或选择 B 逐章讨论
```

### 5.2 直接生成流程

```text
用户确认初始大纲
AI 展示初始大纲和 A/B 生成方式
用户选择 A 直接生成
系统开始生成完整大纲
右侧显示生成进度
```

### 5.3 逐章细化流程

```text
用户选择 B 逐章讨论
AI 逐章询问并记录细节
所有章节确认后
AI 总结：需求已确认，可以生成完整大纲
前端进入 ready_to_generate
用户点击“生成完整大纲”
系统开始生成
```

---

## 六、测试方案

### 6.1 篇幅检测测试

修改：

```text
src/__tests__/brainstorm/length-requirement.test.ts
```

覆盖：

1. 用户输入“标准版，控制在 5000 字左右”返回 true。
2. 用户输入“大概 10 页”返回 true。
3. AI 提问“你期望这份文档的大致篇幅是多少？”但用户未回答时返回 false。
4. AI 提问篇幅后，用户回复 `B` 返回 true。
5. AI 提问非篇幅问题后，用户回复 `B` 返回 false。

### 6.2 prompt 测试

修改：

```text
src/__tests__/prompts/prompt-skills.test.ts
```

覆盖：

1. gathering prompt 包含“不要把篇幅和其他结构问题混在同一轮”的要求。
2. gathering prompt 不再包含“仅在当前轮次自然适合时询问”。
3. direction prompt 保留 A/B 生成方式选择。

### 6.3 phase routing 测试

新增：

```text
src/__tests__/brainstorm/phase-routing.test.ts
```

覆盖：

1. 用户回答最后篇幅问题后，本轮 prompt phase 从 `gathering` 切到 `direction`。
2. 用户一开始主动提供篇幅时，不会误判为“最后篇幅问题已回答”。
3. 非 `gathering` phase 不被改写。

### 6.4 phase 处理测试

建议为 marker 处理逻辑提取一个小函数，便于测试：

```text
输入：当前 marker
输出：目标 phase、是否自动生成
```

覆盖：

```text
NEEDS_GATHERED -> direction，不生成
DIRECTION_CONFIRMED -> mode_select，不生成
GENERATE_DIRECT -> ready，生成
SECTION_BY_SECTION -> section_refine，不生成
ALL_SECTIONS_CONFIRMED -> ready_to_generate，不生成
```

### 6.5 手工验收

中文场景：

1. 新建头脑风暴会话。
2. 输入“我要写一份全栈容器云建设规划，面向内部技术团队”。
3. 前几轮只询问目标、受众、范围、核心内容等结构需求，不混问篇幅。
4. 最后一问单独询问篇幅/字数。
5. 回答“C 完整版，至少 10000 字”后，系统形成可确认初始大纲。
6. 初始大纲后仍显示 A/B：A 直接生成，B 逐章讨论。
7. 选择逐章细化并回答完所有章节问题后，系统显示明确下一步，不自动生成。
8. 点击“生成完整大纲”后，右侧进入生成中状态。

---

## 七、验收标准

本次修复完成后应满足：

1. 篇幅、字数、页数或格式要求必须作为最后独立问题确认，不能混在前几轮结构问题中。
2. AI 自己提到“篇幅”不会被误判为用户已经确认篇幅。
3. 用户未提供篇幅时，服务端不会返回 `NEEDS_GATHERED` 推进流程，而是返回最后篇幅问题。
4. 逐章细化全部完成后不会自动生成大纲。
5. 页面会明确提示用户下一步是生成完整大纲。
6. 用户可以通过右侧按钮或聊天输入触发最终大纲生成。
7. `ready` 和 `ready_to_generate` 状态语义清晰，不再把“等待生成”显示成“生成失败”。

---

## 八、非目标

本次修复不处理以下问题：

1. 不改造大纲生成 worker。
2. 不调整 outline JSON schema。
3. 不改变大纲质量评分逻辑。
4. 不重做头脑风暴页面整体布局。
5. 不改写写作页的章节生成逻辑。

---

## 九、实现优先级

### P0：流程正确性

1. 修正篇幅检测只认用户侧确认。
2. gathering 阶段增加最后篇幅问题硬拦截。
3. 用户回答最后篇幅问题后，本轮直接使用 direction prompt 形成可确认大纲。
4. `ALL_SECTIONS_CONFIRMED` 改为进入 `ready_to_generate`，不自动生成。

### P1：用户提示

1. 增加右侧 `ready_to_generate` 状态 UI。
2. 增加聊天区下一步提示。
3. 支持用户在聊天框输入“生成”触发最终大纲生成。

### P2：测试覆盖

1. 补充篇幅检测单元测试。
2. 更新 prompt 单元测试。
3. 增加 marker 到 phase 的状态测试。

---

## 十、风险与回滚

### 风险

1. 新增 `ready_to_generate` 后，历史会话加载时如果没有 outline，仍可能默认回到 `gathering`，无法恢复精确阶段。
2. 服务端强制篇幅确认后，模型可能在某些短文档场景多问一步。
3. 如果前端只依赖本地 phase，刷新页面后可能丢失 `ready_to_generate` 状态。

### 缓解

1. P0 阶段先保证新会话流程正确；历史会话恢复可按消息 marker 后续增强。
2. 篇幅问题提供“简版”选项，降低短文档用户的额外负担。
3. 即使刷新后回到 `gathering`，用户仍可输入“生成完整大纲”触发生成；后续可增加 session phase 持久化。

### 回滚

如发现新状态影响生成链路，可回滚：

```text
ALL_SECTIONS_CONFIRMED -> ready_to_generate
```

恢复为：

```text
ALL_SECTIONS_CONFIRMED -> ready + generateOutline()
```

篇幅检测和 gathering 阶段硬拦截建议保留，因为它们修复的是独立的流程正确性问题。
