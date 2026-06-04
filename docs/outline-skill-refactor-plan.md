# 大纲生成 Skill 模式重构 + 旧 Prompt 清理方案

> 日期：2026-06-03
> 前置：`outline-generation-pipeline-optimization.md`（已实施的两阶段 Pipeline）
> 目标：将 archetype 骨架从硬编码数据重构为可插拔 Skill 模块，清理旧巨型 prompt 死代码

---

## 一、当前问题

### 1.1 旧巨型 Prompt 仍为死代码

`EN_PROMPTS.outline` 和 `ZH_PROMPTS.outline`（各 ~120 行）在 `outline-worker.ts` 改用两阶段 Pipeline 后已不被调用，但仍保留在 locale 文件中：

| 文件 | 死代码位置 | 行数 |
|------|-----------|------|
| `src/lib/prompts/locales/en-prompts.ts` | `outline` 键（行 139-255） | ~116 行 |
| `src/lib/prompts/locales/zh-CN-prompts.ts` | `outline` 键（行 139-256） | ~117 行 |
| `src/lib/prompts/locales/en-prompts.ts` | `outlineRepair` 键（行 257-265） | ~9 行 |
| `src/lib/prompts/locales/zh-CN-prompts.ts` | `outlineRepair` 键（行 258-266） | ~9 行 |

Worker 不再调用 `buildOutlinePrompt()` 和 `buildOutlineRepairPrompt()`，但它们仍被导出且有测试断言。

### 1.2 Archetype 骨架数据重复

同一 archetype 的骨架信息存在于两套完全独立的数据中：

| 位置 | 格式 | 用途 |
|------|------|------|
| `outline-prompt.ts` 的 `ARCHETYPE_SKELETONS` | 3 字段（principle/skeleton/focus） | ✅ Worker 实际使用 |
| `outline-prompt.ts` 的 `ARCHETYPE_SKELETONS_ZH` | 3 字段（中文） | ✅ Worker 实际使用 |
| `en-prompts.ts` 的 `EN_PROMPTS.outline` | 4 字段（useWhen/principle/skeleton/focus）+ 巨型文本 | ❌ 死代码 |
| `zh-CN-prompts.ts` 的 `ZH_PROMPTS.outline` | 同上中文版 | ❌ 死代码 |

中英文骨架分散在 4 处，且内容存在细微差异（旧版有 `Use when` 字段，新版没有）。

### 1.3 新增 Archetype 需改 3+ 文件

当前新增一种 archetype 需要改动：
1. `outline-prompt.ts` 的 `ARCHETYPE_SKELETONS` — 加英文
2. `outline-prompt.ts` 的 `ARCHETYPE_SKELETONS_ZH` — 加中文
3. （已死代码但仍存在的）`en-prompts.ts` 和 `zh-CN-prompts.ts`
4. 可能还有测试文件

没有做到"加一个文件就完成注册"。

---

## 二、方案设计

### 2.1 Archetype Skill 模块

将每种 archetype 拆成独立文件，中英双语合并在同一文件中：

```
src/lib/brainstorm/archetypes/
  ├── index.ts                  ← 注册表 + 查询 API
  ├── technical-solution.ts     ← { id, label, useWhen, principle, skeleton, focus } × 2 语言
  ├── proposal.ts
  ├── bidding.ts
  ├── consulting.ts
  ├── planning.ts
  ├── assessment.ts
  ├── operations.ts
  └── general.ts
```

**每个 Skill 文件的结构**：

```typescript
import type { ArchetypeSkill } from "./index";

const skill: ArchetypeSkill = {
  id: "technical_solution",
  label: {
    en: "Construction / Implementation Proposals",
    "zh-CN": "建设方案型",
  },
  useWhen: {
    en: "technical proposals, system construction plans, digital transformation, implementation plans",
    "zh-CN": "技术方案、系统建设方案、数字化转型方案、实施方案",
  },
  principle: {
    en: "top-down, architecture-first, then details",
    "zh-CN": "先全局后局部，先架构后细节，逻辑自顶向下",
  },
  skeleton: {
    en: "Overview → Requirements Analysis → Overall Design → Detailed Design → ...",
    "zh-CN": "项目概述 → 需求分析 → 总体设计 → 详细设计 → ...",
  },
  focus: {
    en: "architecture diagrams, justified technology choices with versions, ...",
    "zh-CN": "架构设计需有图、技术选型需有理由和版本、...",
  },
};

export default skill;
```

**注册表 `archetypes/index.ts`**：

```typescript
export interface ArchetypeSkill {
  id: string;
  label: Record<"en" | "zh-CN", string>;
  useWhen: Record<"en" | "zh-CN", string>;
  principle: Record<"en" | "zh-CN", string>;
  skeleton: Record<"en" | "zh-CN", string>;
  focus: Record<"en" | "zh-CN", string>;
}

// 自动注册所有 archetype skill
const registry = new Map<string, ArchetypeSkill>();

export function registerArchetype(skill: ArchetypeSkill): void { ... }
export function getArchetype(id: string): ArchetypeSkill | undefined { ... }
export function getAllArchetypes(): ArchetypeSkill[] { ... }

// 提取 outline-prompt 需要的轻量骨架
export function getArchetypeSkeleton(
  id: string,
  locale: "en" | "zh-CN"
): { principle: string; skeleton: string; focus: string } | undefined { ... }
```

**新增 archetype 的流程**：创建一个文件 → 在 `index.ts` 中 import + register → 完成。

### 2.2 旧 Prompt 清理

| 操作 | 文件 | 内容 |
|------|------|------|
| 删除 | `en-prompts.ts` 的 `outline` 键 | 整个 ~116 行巨型 prompt 字符串 |
| 删除 | `zh-CN-prompts.ts` 的 `outline` 键 | 整个 ~117 行中文字符串 |
| 删除 | `en-prompts.ts` 的 `outlineRepair` 键 | 9 行 |
| 删除 | `zh-CN-prompts.ts` 的 `outlineRepair` 键 | 9 行 |
| 简化 | `prompts/builders/outline.ts` | `buildOutlinePrompt()` 改为调用 archetype 注册表 |
| 删除 | `outline-normalizer.ts` 中 repair 相关 | `needsOutlineRepair`、`buildOutlineRepairPrompt` 及其导入 |

### 2.3 `outline-prompt.ts` 改造

移除硬编码的 `ARCHETYPE_SKELETONS` 和 `ARCHETYPE_SKELETONS_ZH`，改为从 archetype 注册表动态获取：

```typescript
// 改造前
const ARCHETYPE_SKELETONS: Record<string, ArchetypeSkeleton> = { ... };  // 硬编码
const ARCHETYPE_SKELETONS_ZH: Record<string, ArchetypeSkeleton> = { ... }; // 硬编码

// 改造后
import { getArchetypeSkeleton } from "./archetypes";

export function buildLightweightOutlinePrompt(archetype: string, locale: DocumentLanguage): string {
  const primary = archetype.split("+")[0] || "general";
  const primarySkeleton = getArchetypeSkeleton(primary, locale === "zh-CN" ? "zh-CN" : "en");
  // ...
}
```

---

## 三、图表标记功能兼容性确认

在两阶段 Pipeline 优化中，我们验证了图表标记功能（`DIAGRAM_REQUEST` 系统）**完全不受影响**：

| 图表功能依赖项 | 是否保留 | 位置 |
|---------------|---------|------|
| `section.title` | 保留 | 轻量大纲 |
| `section.description` | 保留 | 轻量大纲 |
| `section.keyPoints` | 保留 | 轻量大纲 |
| `sectionNeedsDiagram()` 关键词检测 | 保留 | `context.ts:365` |
| `assembleContext()` 条件注入 | 保留 | `context.ts:428` |
| `DIAGRAM_REQUEST` 语法定义 | 保留 | `writing-diagram-request` Prompt Skill（按需注入） |
| `parseDiagramRequests()` 标记解析 | 保留 | `diagram.ts` |
| 右侧面板图表生成 UI | 保留 | `reference-panel.tsx` |

本次 Skill 模式重构不涉及写作阶段的 context 组装，图表功能不受影响。

---

## 四、测试更新

| 测试文件 | 操作 | 说明 |
|---------|------|------|
| `src/__tests__/i18n/prompt-parity.test.ts` | 修改 | "Outline prompt structural elements" 改为断言 archetype 注册表包含所有 8 种 |
| `src/__tests__/brainstorm/outline-normalizer.test.ts` | 修改 | 删除 `needsOutlineRepair` 和 `buildOutlineRepairPrompt` 的测试用例 |
| `src/__tests__/brainstorm/archetype-registry.test.ts` | 新增 | 验证注册表包含所有 8 种 archetype、中英文字段完整、`getArchetypeSkeleton` 返回正确数据 |

---

## 五、文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 ×9 | `src/lib/brainstorm/archetypes/index.ts` | 注册表 + 查询 API |
| 新增 ×8 | `src/lib/brainstorm/archetypes/technical-solution.ts` 等 | 每种 archetype 一个文件 |
| 新增 ×1 | `src/__tests__/brainstorm/archetype-registry.test.ts` | 注册表测试 |
| 修改 | `src/lib/brainstorm/outline-prompt.ts` | 移除硬编码数据，改用注册表 |
| 修改 | `src/lib/prompts/locales/en-prompts.ts` | 删除 `outline` + `outlineRepair` 键 |
| 修改 | `src/lib/prompts/locales/zh-CN-prompts.ts` | 删除 `outline` + `outlineRepair` 键 |
| 修改 | `src/lib/prompts/builders/outline.ts` | `buildOutlinePrompt()` 改用注册表 |
| 修改 | `src/lib/brainstorm/outline-normalizer.ts` | 删除 `needsOutlineRepair`、`buildOutlineRepairPrompt` |
| 修改 | `src/__tests__/i18n/prompt-parity.test.ts` | 重写 outline 测试 |
| 修改 | `src/__tests__/brainstorm/outline-normalizer.test.ts` | 删除 repair 测试 |

---

## 六、执行顺序

1. 创建 `archetypes/` 目录 + 8 个 skill 文件 + `index.ts` 注册表
2. 修改 `outline-prompt.ts` — 从注册表获取骨架数据
3. 删除 `en-prompts.ts` / `zh-CN-prompts.ts` 中的 `outline` + `outlineRepair`
4. 简化 `prompts/builders/outline.ts`
5. 清理 `outline-normalizer.ts` 中的 repair 逻辑
6. 更新 `prompt-parity.test.ts` + `outline-normalizer.test.ts`
7. 新增 `archetype-registry.test.ts`
8. `npm test` + `npm run build` 验证

---

## 七、风险与缓解

| 风险 | 缓解 |
|------|------|
| 删除旧 prompt 后 `buildOutlinePrompt()` 调用者报错 | 全局搜索确认无其他调用者，`outline-worker.ts` 已直接导入新函数 |
| archetype 注册表初始化时序 | 使用静态 `Map` + 同步注册，无异步依赖 |
| 中英文字段遗漏 | 测试覆盖：每种 archetype 的 5 个字段 × 2 语言 = 10 个断言 |
| `outlineRepair` 被其他地方引用 | 全局搜索确认仅在 `outline-normalizer.ts` 和 worker 中使用，worker 已不再调用 |
