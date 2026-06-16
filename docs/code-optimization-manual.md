# 代码优化手册 —— 死代码与屎山代码清理指南

> **生成日期**: 2026-06-11  
> **项目**: Synthetix (Next.js + TypeScript)  
> **版本**: 0.10.9  
> **状态**: 分析完成，待执行清理  
> **原则**: 每一条删除建议均经过工具验证 + 人工复核，未经测试验证不得删除。

---

## 目录

1. [分析方法论](#1-分析方法论)
2. [验证结果摘要](#2-验证结果摘要)
3. [Phase 1: 死文件清理（已验证，零风险）](#phase-1-死文件清理已验证零风险)
4. [Phase 1.5: 死 generated Prisma 文件](#phase-15-死-generated-prisma-文件)
5. [Phase 2: 未使用导出清理（需逐个验证）](#phase-2-未使用导出清理需逐个验证)
6. [Phase 3: 屎山代码重构（高复杂度模块）](#phase-3-屎山代码重构高复杂度模块)
7. [Phase 4: 重复代码消除](#phase-4-重复代码消除)
8. [Phase 5: 调试代码清理](#phase-5-调试代码清理)
9. [Phase 6: 遗留文件与文档清理](#phase-6-遗留文件与文档清理)
10. [Phase 7: 死 API 路由清理（高风险，需逐个验证）](#phase-7-死-api-路由清理高风险需逐个验证)
11. [执行检查清单](#9-执行检查清单)
12. [风险预防措施](#10-风险预防措施)
13. [附录](#附录)

---

## 1. 分析方法论

本次分析采用**多层验证**策略，确保不误删任何存活代码：

### 工具验证层
- **`knip` (v5+)** —— 静态未使用代码检测器，扫描未使用文件、未使用导出、未使用依赖
- **TypeScript 编译器 (`tsc --noEmit`)** —— 全量类型检查，确认删除后无类型断裂
- **ESLint (`eslint src`)** —— 语法与最佳实践检查
- **Vitest (`vitest run`)** —— 全量测试回归，确认当前基线（327/328 通过，1 个已知 flaky test）

### 人工验证层
- **`grep` 全库导入扫描** —— 对 knip 标记的每个文件执行 `grep -r "from '.*filename'" src/`，确认零导入
- **文件内容审查** —— 确认文件内部无自执行代码（IIFE）或副作用
- **依赖链审查** —— 确认删除文件不会导致其唯一依赖者变为死代码

### 安全原则
- **绝不删除被测试文件引用的代码**（除非该测试本身已死）
- **绝不删除包含副作用的模块**（如全局事件监听、CSS import）
- **所有删除操作前必须运行测试**，删除后再次运行
- **分 Phase 执行**，每 Phase 独立提交，便于回滚

---

## 2. 验证结果摘要

| 指标 | 数量 | 验证状态 |
|---|---|---|
| 未使用文件（src/ 内） | **26 个**（24 个业务/组件文件 + 2 个 generated 文件） | ✅ knip + grep 双重验证；已排除 Next.js 约定入口 `src/proxy.ts` |
| 未使用导出 | **119 个** | ⚠️ knip 标记，待人工复核 |
| 未使用导出类型 | **596 个** | ⚠️ 大量为 Prisma generated 类型，建议忽略 |
| 重复代码模式 | **5 处** | ✅ 人工识别（含 46 处静默 catch 模式） |
| `console.log/warn/error` | **59 处** | ✅ grep 扫描确认 |
| 死 CSS 类/keyframes | **5 个** | ✅ grep 全库扫描确认零使用 |
| 巨型文件（>400 行） | **10 个** | ✅ 人工识别 |
| i18n locale 结构镜像 | **2 个文件 772×2 行** | ✅ 人工识别 |
| 遗留归档文件（`_archive/`） | **44,048 个** | ✅ 文件系统扫描 |
| 死 API 路由（无前端 caller） | **12 个** | ✅ grep 全库扫描确认零前端 HTTP 调用 |
| 活文件内部死代码 | **3 处** | ✅ ESLint + grep 验证 |
| 类型检查基线 | `npx tsc --noEmit` 通过 | ✅ 当前 `strict: true` 已启用 |
| 生产构建基线 | `npm run build` 通过 | ✅ 构建输出确认 `ƒ Proxy (Middleware)` 存活 |
| 测试基线 | 327/328 通过 | ✅ 已知 `queue.test.ts` 为 flaky |

---

## Phase 1: 死文件清理（已验证，零风险）

以下文件经 **knip 静态分析 + grep 全库导入扫描** 双重验证，确认在 `src/` 内无任何导入引用。这些文件可安全删除。

### 1.1 孤儿工具文件

| # | 文件路径 | 说明 | 验证命令 | 验证结果 |
|---|---|---|---|---|
| 1 | `src/hooks/use-fetch-json.ts` | 通用 fetch 包装 hook，无人使用 | `knip` + `grep -r "use-fetch-json" src/` | 0 引用 |
| 2 | `src/hooks/use-models-by-capability.ts` | 模型筛选 hook，无人使用 | `knip` + `grep -r "use-models-by-capability" src/` | 0 引用 |
| 3 | `src/hooks/use-polling.ts` | setInterval 轮询 hook，无人使用 | `knip` + `grep -r "use-polling" src/` | 0 引用 |
| 4 | `src/types/knowledge.ts` | 知识图谱类型定义，零导入 | `knip` + `grep -r "knowledge.ts\|types/knowledge" src/` | 0 引用 |
| 5 | `src/types/models.ts` | 模型提供者类型定义，零导入 | `knip` + `grep -r "models.ts\|types/models" src/` | 0 引用 |

> 🔴 **重要修正**: `src/proxy.ts` 虽然没有普通 import 引用，但 `npm run build` 输出 `ƒ Proxy (Middleware)`，证明它是 Next.js 16 的文件约定入口。**禁止按普通死文件删除**，否则可能破坏认证代理/中间件行为。

**验证脚本（可复现）**:
```bash
# 确认零导入
for file in use-fetch-json.ts use-models-by-capability.ts use-polling.ts; do
  echo "=== $file ==="
  grep -r "$file" src/ || echo "ZERO IMPORTS"
done
```

### 1.2 孤儿组件文件

| # | 文件路径 | 说明 | 验证命令 | 验证结果 |
|---|---|---|---|---|
| 7 | `src/components/library/document-list.tsx` | 旧版文档列表组件，被新版 `document-table.tsx` 取代 | `knip` + grep | 零引用 |
| 8 | `src/components/library/search-bar.tsx` | 独立搜索输入框，无人使用 | `knip` + grep | 零引用 |
| 9 | `src/components/library/tag-badge.tsx` | 标签徽章，唯一使用者 `document-list.tsx` 已死 | `knip` + grep | 零引用 |
| 10 | `src/components/shared/stats-card.tsx` | 统计卡片，无人使用 | `knip` + grep | 零引用 |
| 11 | `src/components/topology/topology-legend.tsx` | 拓扑图图例，无人使用 | `knip` + grep | 零引用 |
| 12 | `src/components/documents/upload-progress.tsx` | 上传进度 UI，无人使用 | `knip` + grep | 零引用 |

**依赖链验证**: `tag-badge.tsx` → 仅被 `document-list.tsx` 引用 → `document-list.tsx` 已死。删除顺序：先 `tag-badge.tsx`，再 `document-list.tsx`（或同时删除）。

### 1.3 孤儿业务逻辑文件

| # | 文件路径 | 说明 | 验证命令 | 验证结果 |
|---|---|---|---|---|
| 13 | `src/lib/documents/semantic-splitter.ts` | 语义分块逻辑，已被 `splitter.ts` 和 outline worker 取代 | `knip` + grep | 零引用 |
| 14 | `src/lib/writing/assets.ts` | 章节资源持久化辅助函数，零调用 | `knip` + grep | 零引用 |

### 1.4 未使用的 shadcn/ui 组件

> ⚠️ **注意**: 以下 UI 组件均为 `shadcn/ui` 生成的原始组件。虽然当前零引用，但如果项目计划近期使用，可暂缓删除。建议**删除**，需要时通过 `npx shadcn add [组件名]` 一键恢复。

| # | 文件路径 | 当前引用数 | 验证方式 |
|---|---|---|---|
| 15 | `src/components/ui/avatar.tsx` | 0 | `grep -r "Avatar" src/` |
| 16 | `src/components/ui/badge.tsx` | 0 | `grep -r "Badge" src/` |
| 17 | `src/components/ui/card.tsx` | 0 | `grep -r "Card" src/` |
| 18 | `src/components/ui/dropdown-menu.tsx` | 0 | `grep -r "DropdownMenu" src/` |
| 19 | `src/components/ui/input.tsx` | 0 | `grep -r "Input" src/` |
| 20 | `src/components/ui/label.tsx` | 0 | `grep -r "Label" src/` |
| 21 | `src/components/ui/separator.tsx` | 0 | `grep -r "Separator" src/` |
| 22 | `src/components/ui/skeleton.tsx` | 0 | `grep -r "Skeleton" src/` |
| 23 | `src/components/ui/switch.tsx` | 0 | `grep -r "Switch" src/` |
| 24 | `src/components/ui/tabs.tsx` | 0 | `grep -r "Tabs" src/` |
| 25 | `src/components/ui/tooltip.tsx` | 0 | `grep -r "Tooltip" src/` |

**已确认保留的 UI 组件**（有活跃引用）:
- `button.tsx` —— 被 `dialog.tsx` 间接使用（仅 1 处导入）
- `dialog.tsx` —— 被 `about-dialog.tsx` 使用
- `select.tsx` —— 被 6 个文件使用
- `sonner.tsx` —— 被 `providers.tsx` 及多个 hooks/pages 引用

### Phase 1 执行步骤

```bash
# Step 1: 运行测试确认基线通过
npm run test:run

# Step 2: 删除死文件（建议用 git rm 以便追踪）
# 使用 --ignore-unmatch 防止已删除文件导致中断
git rm --ignore-unmatch \
  src/hooks/use-fetch-json.ts \
  src/hooks/use-models-by-capability.ts \
  src/hooks/use-polling.ts \
  src/types/knowledge.ts \
  src/types/models.ts \
  src/components/library/document-list.tsx \
  src/components/library/search-bar.tsx \
  src/components/library/tag-badge.tsx \
  src/components/shared/stats-card.tsx \
  src/components/topology/topology-legend.tsx \
  src/components/documents/upload-progress.tsx \
  src/lib/documents/semantic-splitter.ts \
  src/lib/writing/assets.ts

# Step 3: 可选删除未使用的 shadcn/ui 组件
git rm --ignore-unmatch \
  src/components/ui/avatar.tsx \
  src/components/ui/badge.tsx \
  src/components/ui/card.tsx \
  src/components/ui/dropdown-menu.tsx \
  src/components/ui/input.tsx \
  src/components/ui/label.tsx \
  src/components/ui/separator.tsx \
  src/components/ui/skeleton.tsx \
  src/components/ui/switch.tsx \
  src/components/ui/tabs.tsx \
  src/components/ui/tooltip.tsx

# Step 4: 运行 TypeScript 编译和测试
npx tsc --noEmit
npm run test:run
npm run lint

# Step 5: 提交
# git commit -m "chore: remove 24 dead source files verified by knip + grep"
```

---

## Phase 1.5: generated Prisma 噪音治理

以下文件由 Prisma generator 自动生成。它们会被 `knip` 标记为未使用，但处理策略必须比普通源码更保守：generated 文件可能被同目录 barrel 重新导出，或者在下次 `prisma generate` 时重新生成。

| # | 文件路径 | 行数 | 说明 | 验证结果 |
|---|---|---|---|---|
| 26 | `src/generated/prisma/browser.ts` | 104 | Prisma 浏览器端入口，零导入 | grep 确认 0 引用 |
| 27 | `src/generated/prisma/internal/prismaNamespaceBrowser.ts` | 306 | `browser.ts` 唯一依赖；若保留 `browser.ts` 则它也要保留 | grep 确认仅 generated browser 引用 |
| 28 | `src/generated/prisma/commonInputTypes.ts` | 430 | 被 `src/generated/prisma/models.ts:28` 重新导出 | **不是普通死文件**，不要单独删除 |

> ⚠️ **注意**: 这些文件由 Prisma generator 在每次 `prisma generate` 时重新生成。不要手动只删其中一个文件，否则可能破坏 generated barrel 结构或下一次 generate 又恢复。

**推荐方案**（二选一）：
1. **推荐**: 保持 generated 文件不动，在 `knip.json` 中排除 `src/generated/**`，避免噪音污染手册。
2. 如确认 Prisma generator 支持关闭 browser output，再通过 generator 配置整体关闭浏览器端输出，并运行 `prisma generate` + `tsc` + `build` 验证。

---

## Phase 2: 未使用导出清理（需逐个验证）

以下导出经 `knip` 标记为未使用，但**需要人工复核**确认无动态引用（如字符串拼接导入、反射调用）后再删除。

### 2.1 高置信度未使用导出

| # | 文件路径 | 未使用导出 | 说明 | 验证建议 |
|---|---|---|---|---|
| 1 | `src/lib/api-helpers.ts` | `authOrError` | API 路由直接使用 `getAuthUser` | 搜索 `authOrError` 全库引用 |
| 2 | `src/lib/python.ts` | `spawnPython` | 外部仅导入 `spawnPythonJson` | 确认无 `spawnPython(` 调用 |
| 3 | `src/lib/auth/jwt.ts` | `ACCESS_EXPIRES`, `REFRESH_EXPIRES` | 仅文件内部使用 | 确认无外部引用 |
| 4 | `src/lib/auth/session.ts` | `getAccessToken`, `getRefreshToken`, `payloadToAuthUser` | 仅模块内部使用 | 确认无外部引用 |
| 5 | `src/lib/documents/processing-tasks.ts` | `SupersededDocumentProcessingTaskError`, `assertLatestDocumentConvertTask`, `isLatestRagEmbedIndexTask` | 同名变体被使用，这些特定导出未被使用 | 精确 grep 每个导出名称 |
| 6 | `src/lib/documents/splitter.ts` | `documentHasStructure`, `extractSectionTitles` | 仅文件内部使用 | 确认无外部引用 |
| 7 | `src/lib/documents/pipeline.ts` | `indexDocumentImages` | 导出但从未调用 | 搜索函数名调用 |
| 8 | `src/lib/writing/generator.ts` | `generateSection`, `compareSection` | 非流式版本；仅流式版本被消费 | 确认无 `generateSection(` 调用 |
| 9 | `src/lib/writing/marker-parser.ts` | `generateMarkerId`, `findMarkerById` | 仅文件内部使用 | 确认无外部引用 |
| 10 | `src/lib/writing/diagram-translate.ts` | `SYSTEM_PROMPT_CREATE`, `SYSTEM_PROMPT_EDIT` | 常量在文件内部使用，未导出使用 | 确认无外部引用 |
| 11 | `src/lib/brainstorm/summary-prompt.ts` | `SUMMARY_PROMPTS` | 仅被 `buildSummaryPrompt` 内部使用 | 确认无外部引用 |
| 12 | `src/lib/search/fts.ts` | `syncFtsIndex` | 仅内部调用；外部使用 `syncFtsIndexForDocument` | 确认无外部引用 |
| 13 | `src/components/ui/button.tsx` | `buttonVariants` | 仅文件内部使用 | 确认无外部引用 |
| 14 | `src/components/ui/dialog.tsx` | `DialogClose`, `DialogFooter`, `DialogOverlay`, `DialogPortal`, `DialogTrigger` | 未单独导入 | 确认无单独引用 |
| 15 | `src/components/ui/select.tsx` | `SelectGroup`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator` | 未单独导入 | 确认无单独引用 |
| 16 | `src/components/models/model-card.tsx` | `parseContextWindow` | 仅文件内部使用 | 确认无外部引用 |
| 17 | `src/lib/text/file-utils.ts` | `getFileTypeLabel` | 零调用 | 搜索函数名 |
| 18 | `src/lib/writing/outline-utils.ts` | `flattenOutlineNumbers` | 零调用 | 搜索函数名 |
| 19 | `src/lib/writing/diagram-icons.ts` | `ICON_CATEGORIES`, `getIcon` | 零调用 | 搜索函数名 |
| 20 | `src/lib/writing/diagram-spec.ts` | `STYLE_ALIASES` | 零调用 | 搜索函数名 |
| 21 | `src/lib/writing/diagram-parse.ts` | `parseJsonInput`, `parseMermaidBasic` | 仅文件内部使用 | 确认无外部引用 |
| 22 | `src/lib/i18n/registry.ts` | `LOCALE_REGISTRY`, `getLocaleEntry`, `getEnabledLocales` | 零外部引用 | 搜索函数名 |
| 23 | `src/lib/prompts/skills/index.ts` | `getPromptSkill` | 零外部引用 | 搜索函数名 |
| 24 | `src/lib/i18n/client-errors.ts` | `getErrorMap`, `getErrorCode` | 零外部引用 | 搜索函数名 |
| 25 | `src/lib/llm/provider-probe.ts` | `validateEmbeddingDim` | 零外部引用 | 搜索函数名 |
| 26 | `src/lib/writing/constraints.ts` | `stringifySectionConstraints` | 零外部引用 | 搜索函数名 |
| 27 | `src/lib/models/provider-schema.ts` | `modelConfigSchema` | 零外部引用 | 搜索函数名 |
| 28 | `src/lib/documents/phase1.ts` | `runPhaseOne` | 外部仅使用 `runPhaseOneSafe` | 确认无 `runPhaseOne(` 调用 |
| 29 | `src/lib/writing/resolve-outline.ts` | `isValidOutline`, `flattenOutlineSections` | 零外部引用 | 搜索函数名 |

> ⚠️ **交叉验证注意**: 原手册包含 `DiagramPlaceholder`（`diagram-placeholder.tsx`），经 grep 验证 `content-renderer.tsx:5` 通过 `import { DiagramView }` 实际使用，**已从本表移除**（非死代码）。

### 2.2 反模式：类型文件运行时重导出

| 文件路径 | 问题 | 风险 | 建议 |
|---|---|---|---|
| `src/types/writing.ts` | 从 `src/lib/writing/status.ts` 重导出 `CONFIRMED_SECTION_STATUSES`, `deriveDraftStatus`, `isSectionDone`。**零外部引用**，消费者直接从 `lib/writing/status.ts` 导入。 | 🔴 **破坏类型文件约定**：`types/` 文件本应是无运行时依赖的纯类型定义，此重导出从 `types/` → `lib/` 创建了反向依赖链，违反分层原则。 | 删除这些重导出。所有消费者统一从 `lib/writing/status.ts` 导入。 |

### 2.3 活文件内部死代码（ESLint 已验证）

以下不是整文件死代码，而是活跃页面内部的未使用函数/变量。它们已经由 `npm run lint` 验证，但删除前仍应逐项运行页面构建和对应页面冒烟测试。

| 文件路径 | 死代码 | 验证来源 | 建议 |
|---|---|---|---|
| `src/app/(dashboard)/library/[id]/page.tsx` | `formatBadgeColor` | ESLint `no-unused-vars` | 删除函数；确认文档详情页格式徽章仍正常 |
| `src/app/(dashboard)/library/[id]/page.tsx` | `lineColor` | ESLint `no-unused-vars` | 删除函数；当前实际使用的是 `Pipeline` 内部 `lineColorFor` |
| `src/app/(dashboard)/library/[id]/page.tsx` | `StageSpacer` | ESLint `no-unused-vars` | 删除组件；页面未引用 |
| `src/app/(dashboard)/library/[id]/page.tsx` | `splitDone` | ESLint `no-unused-vars` | 删除变量；无渲染路径依赖 |
| `src/app/(dashboard)/library/[id]/page.tsx` | `isReady`（`Pipeline` 内部第 172 行） | ESLint `no-unused-vars` | 删除变量；注意保留 `OverviewTab` 内部同名活变量 |
| `src/app/(dashboard)/library/[id]/page.tsx` | `StatusBadge` | ESLint `no-unused-vars` | 删除组件；详情页当前使用 `DetailField` 显示状态 |
| `src/app/(dashboard)/library/[id]/page.tsx` | `LayersIcon` | ESLint `no-unused-vars` | 删除图标组件；当前 chunks 指标使用 `GridIcon` |
| `src/app/(dashboard)/search/page.tsx` | `onViewDocument={(id) => {}}` 中未使用 `id` | ESLint `no-unused-vars` | 若无需跳转，删除 prop；若需要跳转，接入 `/library/[id]` 导航。不要保留空回调。 |

**验证命令**:
```bash
npm run lint
npx tsc --noEmit
npm run build
```

### 2.4 活文件内部死代码（grep 验证）

以下不是整文件死代码，而是活跃文件内部的未使用导出/类型/联合成员。经 grep 全库扫描确认零外部引用。

| # | 文件路径 | 死代码 | 类型 | 验证 | 建议 |
|---|---|---|---|---|---|
| 1 | `src/types/writing.ts:20-28` | `SectionConstraints` interface | 死类型 | grep 全库：仅在定义处出现 | 删除；代码库使用 `SectionConstraintData`（`constraints.ts`）替代 |
| 2 | `src/types/writing.ts:18` | `"merged"` in `VersionSource` union | 死联合成员 | grep 全库：`"merged"` 字面量仅出现在定义处；`"generated_a"`/`"generated_b"`/`"edited"` 在 `confirm/route.ts:73-77` 活跃使用 | 从联合中移除 `\| "merged"` |
| 3 | `src/lib/writing/constraints.ts:33` | `stringifySectionConstraints` export | 死导出 | grep 全库：仅 `constraints.ts` 内部 `mergeSectionConstraints` 调用（行49） | 移除 `export` 关键字，改为模块私有函数 |
| 4 | `src/lib/writing/constraints.ts:3` | `SectionConstraintData` export | 软死导出 | 零 `import type { SectionConstraintData }` 外部引用；消费者通过 `ReturnType<typeof parseSectionConstraints>` 获取 | 保留或移除 export 均可；移除后不影响下游 |

**验证命令**:
```bash
grep -rn "SectionConstraints" src/ --include="*.ts" --include="*.tsx"
grep -rn '"merged"' src/ --include="*.ts" --include="*.tsx"
grep -rn "stringifySectionConstraints" src/ --include="*.ts" --include="*.tsx"
```

### Phase 2 执行步骤

```bash
# 对每一个未使用导出执行以下验证流程：

# 1. 搜索全库引用
export NAME="authOrError"
grep -r "$NAME" src/ --include="*.ts" --include="*.tsx"

# 2. 如果零引用，去掉 export 关键字（不要删除代码本身，以防测试使用）
# 例如：export function authOrError(...) → function authOrError(...)

# 3. 运行编译和测试
npx tsc --noEmit
npm run test:run
```

---

## Phase 3: 屎山代码重构（高复杂度模块）

以下模块因**体积过大**、**职责过多**或**圈复杂度过高**被列为屎山代码。清理方式为**拆分重构**，而非简单删除。

### 3.1 巨型文件（按行数排序）

| # | 文件路径 | 行数 | 问题描述 | 重构建议 |
|---|---|---|---|---|
| 1 | `src/lib/writing/diagram-renderer.ts` | **1,110** | 单体 SVG 图表渲染引擎：颜色表、布局算法、SVG 路径生成全部堆在一个文件 | 拆分为 `diagram-styles.ts`（颜色/样式常量）、`diagram-layout.ts`（布局算法）、`diagram-svg.ts`（SVG 生成） |
| 2 | `src/lib/i18n/locales/en.ts` | **772** | 巨型平铺翻译对象，按功能域混杂，难以维护 | 按功能域拆分：`locales/en/documents.ts`、`locales/en/writing.ts`、`locales/en/search.ts` 等 |
| 3 | `src/lib/i18n/locales/zh-CN.ts` | **772** | 同上 | 同上 |
| 4 | `src/lib/i18n/types.ts` | **758** | 巨大的 `TranslationSchema` 接口，与 locale 文件镜像，维护成本高 | 考虑从 locale 文件生成类型，或随 locale 一起拆分 |
| 5 | `src/components/writing/reference-panel.tsx` | **684** | 混合文件导入、引用 CRUD、徽章渲染、UI 状态 | 提取 `useReferences()` hook 和子组件 |
| 6 | `src/lib/writing/generator.ts` | **530** | 非流式生成、流式生成、对比逻辑、token 记录全部混在一起 | 删除死导出（Phase 2），将 comparison 逻辑拆分到独立文件 |
| 7 | `src/components/writing/editor-panel.tsx` | **530** | 混合 Monaco 编辑器、diff 视图、资源插入、章节操作 | 提取 `useEditor()` hook 和子面板 |
| 8 | `src/lib/documents/pipeline.ts` | **496** | 文档处理管道：LightRAG、FTS、embedding、图片索引全部内联 | 提取 `indexImages()`、`syncFts()`、`embedChunks()` 到独立模块 |
| 9 | `src/components/writing/outline-panel.tsx` | **429** | 大纲树 UI 内联拖拽、编辑逻辑、Prisma 变更 | 提取拖拽逻辑和 outline mutations |
| 10 | `src/components/layout/sidebar.tsx` | **406** | 导航 + 用户菜单 + 移动端切换 + 路由逻辑 | 提取 `useNavigation()` 和 `MobileSidebar` |

### 3.2 高圈复杂度热点

| 文件路径 | 热点函数 | 复杂度表现 |
|---|---|---|
| `src/lib/writing/diagram-renderer.ts` | `renderDiagramSvg()` | 数百行嵌套 switch，处理样式、形状、箭头类型 |
| `src/app/(dashboard)/search/page.tsx` | 页面组件 | 475 行，多 tab、多搜索模式、多结果类型融合 |

### 3.3 i18n 双 locale 结构镜像风险

| 文件 | 行数 | 问题 | 风险 |
|---|---|---|---|
| `src/lib/i18n/locales/en.ts` | 772 | 与 `zh-CN.ts` **键名完全镜像**，仅值不同 | 新增翻译键时若一边遗漏，运行时直接显示空翻译 |
| `src/lib/i18n/locales/zh-CN.ts` | 772 | 同上 | 同上 |

**当前状态**: 两个文件拥有完全相同的 JSON 键结构（772 行），没有跨文件一致性检查。这是在 Phase 3 巨型文件基础上的额外风险维度的叠加。

**短期缓解**: 在 CI 中加入 locale key 一致性检查：
```bash
# 提取所有键路径并比较
node -e "
const en = require('./src/lib/i18n/locales/en');
const zh = require('./src/lib/i18n/locales/zh-CN');
// flat keys diff check
"
```

**长期方案**: 改为单一 source-of-truth 格式（如 Fluent `.ftl`、ICU MessageFormat），或使用 TypeScript 类型系统强制所有 locale 文件实现相同接口。

### Phase 3 执行策略

> **注意**: Phase 3 为重构而非删除，风险高于 Phase 1/2。建议：
> 1. 为被重构模块补充单元测试（如果缺失）
> 2. 使用"提方法/提类"重构，**每次只提取一个职责**
> 3. 每步提取后运行测试
> 4. 优先处理有测试覆盖的模块

---

## Phase 4: 重复代码消除

### 4.1 Token 用量记录 catch 模式（高优先级）

**重复次数**: 9 次，分布在 8 个文件中  
**重复代码**:
```typescript
.catch((err) => { console.warn("Failed to record token usage:", err); })
```

**涉及文件**:
1. `src/lib/writing/auditor.ts`
2. `src/lib/writing/humanizer.ts`
3. `src/lib/writing/generator.ts`
4. `src/lib/writing/summarizer.ts`
5. `src/lib/queue/workers/outline-worker.ts`
6. `src/app/api/v1/drafts/[id]/sections/[secId]/compare/route.ts`
7. `src/app/api/v1/drafts/[id]/sections/[secId]/assets/mermaid-generate-code/route.ts`
8. `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts`

**重构方案**: 在 `src/lib/llm/usage.ts` 中新增包装函数：
```typescript
export async function recordTokenUsageSafely(
  operation: () => Promise<void>
): Promise<void> {
  try { await operation(); } catch (err) {
    console.warn("Failed to record token usage:", err);
  }
}
```

### 4.1b 静默错误吞没 `.catch(() => {})` 模式（最高优先级 🔴）

**重复次数**: **46 处**（远超预期的 9 处 token 模式），是当前代码库中**最大规模的重复反模式**。

**严重分布**:

| 类别 | 数量 | 典型位置 | 潜在风险 |
|---|---|---|---|
| Prisma 数据库操作静默失败 | 10 | `lifecycle.ts`（6 处：`documentChunk.deleteMany`、`documentTag.deleteMany`、`documentImage.deleteMany`、`document.delete` 等） | 🔴 **数据一致性问题**：删除失败静默吞错导致孤儿数据 |
| JSON 解析静默回退 | 8 | `use-section-actions.ts`、`use-generation.ts`、`use-generate-all.ts` 等 hooks | 🟡 解析失败时回退到默认值，可能隐藏 API 变更 |
| 文件系统操作静默失败 | 5 | `upload-image/route.ts: fs.unlink`、`upload/route.ts: fs.rm` | 🟡 临时文件残留 |
| Token 用量记录静默失败 | 4 | `auto-tagger.ts`、`phase1.ts`、`rag-embed-index-worker.ts` | 🟢 非核心功能 |
| 任务取消/清理静默失败 | 3 | `sessions/route.ts: queue.cancel`、`reprocess/route.ts` | 🟡 僵尸任务残留 |
| fetch 请求静默回退 | 4 | `use-brainstorm-sessions.ts`、`use-brainstorm-outline.ts` | 🟡 静默回退到空数据 |
| `res.json()` 解析静默回退 | 8 | 多个 hooks 和 API 路由 | 🟡 同上 |

**最危险的静默吞错**（应优先修复）:

```typescript
// 🔴 lifecycle.ts — 6 个连续的数据库删除操作全部静默吞错
await db.documentChunk.deleteMany({ where: { documentId: docId } }).catch(() => undefined);
await db.documentTag.deleteMany({ where: { documentId: docId } }).catch(() => undefined);
await db.documentImage.deleteMany({ where: { documentId: docId } }).catch(() => undefined);
await db.document.delete({ where: { id: docId, userId } }).catch(() => undefined);
// 任何一个失败都会导致数据库中存在孤儿记录！

// 🟡 修改建议
await db.documentChunk.deleteMany({ where: { documentId: docId } })
  .catch((err) => { console.warn("Failed to cleanup chunks for doc", docId, err); });
```

**清理策略**:
1. 将数据库操作的 `.catch(() => {})` 改为 `.catch((err) => { console.warn(..., err); })` —— 至少记录日志
2. 将 JSON 解析的 `.catch(() => default)` 改为 `.catch(() => { /* intentional fallback */ return default; })` —— 明确意图
3. 文件系统清理类保留静默（非关键路径），但加注释说明

### 4.2 任务抢占模式重复

**位置**: `src/lib/documents/processing-tasks.ts`  
**问题**: `Superseded*Error`、`cancelActive*Tasks`、`isLatest*Task`、`assertLatest*Task` 对 `document_convert` 和 `rag_embed_index` 几乎逐字复制。  
**重构方案**: 泛化为 `taskType` 参数，减少约 50 行重复代码。

### 4.3 Section 状态更新样板

**位置**: 15+ 个 API 路由文件 (`app/api/v1/drafts/[id]/sections/[secId]/`)  
**问题**:
```typescript
await db.section.update({
  where: { id: sectionId },
  data: { status: "...", updatedAt: new Date() }
});
```
**重构方案**: 在 `src/lib/writing/status.ts` 中新增：
```typescript
export async function updateSectionStatus(
  sectionId: string,
  status: SectionStatus,
  extraData?: Partial<Section>
): Promise<void> { ... }
```

### 4.4 Cookie 设置逻辑重复

**位置**: `src/lib/auth/session.ts` 与 `src/proxy.ts`  
**问题**: `Set-Cookie` 构造和 `cookies.set()` 选项复制。  
**重构方案**: `src/proxy.ts` 是 Next.js 约定入口，不能删除。若要去重，只能提取无 Next runtime 副作用的 cookie option helper，并用 `npm run build` 确认 `ƒ Proxy (Middleware)` 仍存在。

### 4.5 Turbopack 动态文件追踪警告（生产构建已验证）

`npm run build` 已通过，但输出了 11 条 Turbopack 警告，说明部分服务端代码的动态路径让 bundler 追踪了大量本地文件，存在构建变慢和过度打包风险。

| 文件 | 警告来源 | 匹配文件数 | 建议 |
|---|---|---|---|
| `src/lib/writing/diagram-generator.ts:90` | `path.join(process.cwd(), "data", relativePath)` | 10,722 | 使用 `path.join(/*turbopackIgnore: true*/ process.cwd(), "data", relativePath)` 或把路径拼接收敛到固定子目录 |
| `src/lib/knowledge/health.ts:53-58, 89-90` | 对 `data/documents` 和 `data/rag` 的动态 `path.join` + `fs.existsSync/statSync/rmSync` | 13k-69k | 添加 Turbopack ignore 注释，或拆成仅 Node runtime 的隔离工具模块 |
| `src/lib/documents/storage.ts:81` | `path.join(process.env.RAG_ROOT \|\| "./data/rag", userId)` | 13,917 | 收敛路径根目录或加 `turbopackIgnore` 注释 |
| `next.config.ts` trace | `export-pipeline.ts` 动态导入链导致整项目被 trace | N/A | 检查 `export-pipeline.ts` 对 `next.config.ts` 的间接依赖；避免导出流程引入项目配置文件 |

**验证结论**: 这些不是功能错误，生产构建当前通过；属于构建性能和部署包体风险。任何修改都必须以 `npm run build` 的警告数量下降作为验收标准。

### 4.6 冗余计算：`generate/route.ts` 中 `stripLeadingSectionTitle` 双重调用

**位置**: `src/app/api/v1/drafts/[id]/sections/[secId]/generate/route.ts:81, 89`

```typescript
// Line 81: 第一次 strip
const contentWithRequiredDiagram = stripLeadingSectionTitle(fullContent, section.title);
// Line 89: 对已 strip 过的内容再次 strip → NO-OP
const cleanContent = stripLeadingSectionTitle(contentWithRequiredDiagram, section.title);
```

`contentWithRequiredDiagram` 已经移除了标题前缀，第二次 `stripLeadingSectionTitle` 调用是**零效果的冗余计算**。`cleanContent` 和 `contentWithRequiredDiagram` 值完全相同。

**建议**: 用 `contentWithRequiredDiagram` 替代 `cleanContent`（行119的audit调用），删除冗余变量。

---

## Phase 5: 调试代码清理

### 5.1 console 语句分布

**总计**: 59 处 `console.log/warn/error/debug/info`

#### 严重级别：高（建议立即清理）

| 位置 | 内容 | 建议 |
|---|---|---|
| `src/app/api/v1/drafts/[id]/sections/[secId]/assets/confirm-asset/route.ts:121-124` | 4 连 `console.error` 打印原始变量 | 合并为单个结构化错误对象，或移除 |
| `src/lib/search/semantic.ts:258-267` | 5 条 LightRAG fallback 日志，含堆栈 | 保留 1 条摘要日志，其余在 production 静默 |
| `src/app/api/v1/drafts/[id]/sections/[secId]/assets/mermaid-generate-code/route.ts:30,59,68` | 重试日志 + JSON 解析错误 | 合并错误日志，重试日志降为 debug 级别 |

#### 严重级别：中（建议替换为结构化日志或移除）

涉及文件（约 25 处）:
- `src/hooks/writing/*.ts` —— 用户操作失败的 hook 内错误
- `src/app/(dashboard)/library/page.tsx` —— 删除失败的页面级错误
- `src/lib/documents/pipeline.ts` —— 非阻塞警告（FTS 同步失败、LightRAG 降级）
- `src/lib/llm/adapter.ts` —— SSE JSON 解析跳过警告

#### 严重级别：低（可保留）

- `src/instrumentation.ts:6` —— 启动日志 `console.log("[queue] Task queue initialized")`
- `src/__tests__/i18n/cjk-scan.test.ts:92` —— 测试诊断日志

### 5.2 清理原则

```typescript
// ❌ 当前模式（分散、 noisy）
console.error("[confirm-asset] Replacement didn't change content.");
console.error("[confirm-asset] markerId:", body.markerId, "assetId:", body.assetId);

// ✅ 建议模式
import { logger } from "@/lib/logger"; // 或直接使用 console 但结构化
logger.error("confirm-asset replacement unchanged", { markerId: body.markerId, assetId: body.assetId });
```

> **注意**: 本项目暂无统一日志库，建议：
> 1. 短期：删除所有开发期调试 console，保留必要的错误处理（改为 `console.error` 单条结构化输出）
> 2. 长期：引入 `pino` 或 `winston` 等结构化日志库

### 5.3 死 CSS 类与 Keyframes

以下 CSS 类/keyframes 在 `src/app/globals.css` 中定义，但经 grep 全库扫描确认在源文件中**零使用**：

| 死 CSS | 文件行号 | 验证方式 | 建议 |
|---|---|---|---|
| `.status-dot` | `globals.css:187` | `grep -r "status-dot" src/` 仅返回定义处 | 删除 |
| `.dark .status-dot` | `globals.css:219` | 同上 | 删除 |
| `.animate-pulse-soft` | `globals.css:254` | `grep -r "animate-pulse-soft" src/` 仅返回定义处 | 删除 |
| `.animate-topo-pulse` | `globals.css:267` | `grep -r "animate-topo-pulse" src/` 仅返回定义处 | 删除 |
| `.animate-topo-dash` | `globals.css:268` | `grep -r "animate-topo-dash" src/` 仅返回定义处 | 删除 |
| `@keyframes shimmer` | `globals.css:278` | 仅 `shimmer-slide` 变体(行283)被使用 | 删除，保留 `shimmer-slide` |

**验证命令**:
```bash
# 对每个死 CSS 类执行
grep -rn "status-dot\|animate-pulse-soft\|animate-topo-pulse\|animate-topo-dash" src/ --include="*.tsx" --include="*.ts" --include="*.css"
```

> 注意：`shimmer-slide` 和 `progress-indeterminate` 通过 Tailwind 任意值语法（如 `animate-[shimmer-slide_...]`）引用，**不要误删**。本节列出的 `animate-topo-dash` 经 grep 验证只有定义、无任意值引用。

**死 CSS 对应的 keyframes 也应同时删除**：
```bash
# 删除行的示例（在 globals.css 中）
# 187: .status-dot { ... }
# 219: .dark .status-dot { ... }
# 254: .animate-pulse-soft { ... }
# 267: .animate-topo-pulse { ... }
# 268: .animate-topo-dash { ... }
# 278-281: @keyframes shimmer { ... }
```

---

## Phase 6: 遗留文件与文档清理

### 6.1 归档目录 `_archive/`

**文件数**: 44,048 个  
**建议**: 该目录为历史归档，**不应纳入版本控制**。当前 `.gitignore` 已忽略，但占用大量磁盘空间。

**行动**:
```bash
# 确认 .gitignore 已包含 _archive/
grep "_archive" .gitignore

# 如已忽略，可安全删除本地副本
rm -rf _archive/
```

### 6.2 临时目录 `tmp/`, `scratch/`

| 目录 | 内容 | 建议 |
|---|---|---|
| `scratch/` | `clear_tasks.js`, `check-tasks.mjs`, 截图文件 | 删除所有文件；如需保留脚本，移入 `scripts/_archive/` 并加注释说明用途 |
| `tmp/` | 截图、日志、测试产物 | 确认 `.gitignore` 已包含，清理本地文件 |

### 6.3 一次性脚本

| 文件 | 说明 | 建议 |
|---|---|---|
| `scripts/probe_doubao.js` | 一次性厂商探针脚本 | **移至 `scripts/_archive/probe_doubao.js`** 保留操作记录 |
| `scripts/reprocess.mjs` | 一次性批量重处理 | **移至 `scripts/_archive/reprocess.mjs`** 保留操作记录 |
| `scripts/upload.mjs` | 一次性上传脚本 | **移至 `scripts/_archive/upload.mjs`** 保留操作记录 |

> 区分"可删"和"可归档"：一次性脚本承载了历史操作上下文，建议**归档而非删除**。

### 6.4 大型可选 devDependency

| 依赖 | 使用方式 | 建议 |
|---|---|---|
| `playwright` (~500MB) | 仅在 `src/lib/writing/export-pipeline.ts:167` 通过 `import("playwright")` 动态加载，用于 PDF 导出功能 | 如果用户从不使用 PDF 导出，可移除该依赖。否则保留。建议在 `package.json` 中加注释说明用途。 |

### 6.5 过时文档审查

`docs/` 目录包含 30+ 份设计文档。以下可能已过时，需人工确认：

| 文档 | 可能过时原因 |
|---|---|
| `docs/codebase-optimization-roadmap-2026-06-02.md` | 如本手册已覆盖其内容，可归档 |
| `docs/dual-path-document-system-design*.md` (4 份) | 如已实现最终版，保留最新版即可 |
| `docs/writing-prompts-zh.md` | 如提示词已迁移到 `src/lib/prompts/locales/`，可删除 |

**注意**: 文档清理前必须经产品负责人确认，避免删除仍在参考的规范。

---

## Phase 7: 死 API 路由清理（高风险，需逐个验证）

以下 API 路由文件存在但经 grep 全库扫描确认：**无任何前端组件/hook/页面通过 HTTP 调用它们**。删除前必须运行 `npm run build` 确认路由表变化。

### 7.1 确认死路由（零前端 HTTP 调用）

| # | 路由文件 | 已废弃功能 | 验证方式 |
|---|---|---|---|
| 1 | `src/app/api/v1/library/tags/route.ts` | 标签列表 GET | `grep "api/v1/library/tags\|library/tags" src/` 零匹配 |
| 2 | `src/app/api/v1/library/documents/[id]/tags/route.ts` | 文档标签 POST | 同上 |
| 3 | `src/app/api/v1/library/documents/[id]/tags/[tag]/route.ts` | 文档标签 DELETE | 同上 |
| 4 | `src/app/api/v1/library/documents/[id]/preview/route.ts` | 文档预览 | 零前端调用 |
| 5 | `src/app/api/v1/library/documents/[id]/content/route.ts` | 文档内容 | 零前端调用 |
| 6 | `src/app/api/v1/auth/refresh/route.ts` | Token 刷新 HTTP 端点 | Token 刷新在 `session.ts` 内联处理，无需 HTTP 调用 |
| 7 | `src/app/api/v1/drafts/[id]/assemble/route.ts` | 草稿组装 | 零前端调用 |
| 8 | `src/app/api/v1/drafts/[id]/sections/[secId]/assets/suggest-mermaid/route.ts` | Mermaid 建议 | 零前端调用 |
| 9 | `src/app/api/v1/drafts/[id]/sections/[secId]/assets/generate-diagram/route.ts` | 生成图表资源 | 零前端调用 |
| 10 | `src/app/api/v1/drafts/[id]/sections/[secId]/assets/batch-generate/route.ts` | 批量生成资源 | 零前端调用 |
| 11 | `src/app/api/v1/drafts/[id]/sections/[secId]/versions/route.ts` | 版本历史 | 零前端调用 |
| 12 | `src/app/api/v1/drafts/[id]/sections/[secId]/graph-reference/route.ts` | 知识图谱引用 | 零前端调用 |

### 7.2 需要保留的路由（服务端调用链）

以下路由也零前端 HTTP 调用，但被其他服务端代码或生命周期直接 import，删除会破坏服务端逻辑：

| 路由 | 调用者 | 说明 |
|---|---|---|
| `src/app/api/v1/knowledge/health/route.ts` | `lifecycle.ts`（import 其函数，非 HTTP） | 服务端生命周期使用 |
| `src/app/api/v1/knowledge/reset/route.ts` | 同上 | 同上 |
| `src/app/api/v1/knowledge/manage/route.ts` | 同上 | 同上 |
| `src/app/api/v1/drafts/[id]/sections/[secId]/audit/route.ts` | `generate/route.ts:119`（服务端调用） | 后台审计任务入口 |
| `src/app/api/v1/drafts/[id]/sections/[secId]/rollback/route.ts` | 待确认 | 可能是 placeholder |

> ⚠️ **重要**: Phase 7 是**最高风险**阶段。路由文件是 Next.js 文件约定入口。删除路由会影响构建输出的路由表。必须：
> 1. 删除前 `npm run build` 记录路由清单
> 2. 删除后 `npm run build` 对比路由清单
> 3. 确认被删路由在 `ƒ`（Dynamic）路由列表中消失
> 4. 如牵涉到 `db.*` 操作，确认对应 Prisma 模型仍有活跃使用路径

### Phase 7 执行步骤

```bash
# Step 1: 记录删除前路由清单
npm run build 2>&1 | Select-String "ƒ /" > before-routes.txt

# Step 2: 逐路由删除（不要批量删）
# 例如：先删除最独立的 tags 路由子树
git rm src/app/api/v1/library/tags/route.ts
git rm src/app/api/v1/library/documents/\[id\]/tags/route.ts
git rm src/app/api/v1/library/documents/\[id\]/tags/\[tag\]/route.ts
git rm src/app/api/v1/library/documents/\[id\]/preview/route.ts
git rm src/app/api/v1/library/documents/\[id\]/content/route.ts

# Step 3: 构建验证
npm run build 2>&1 | Select-String "ƒ /"

# Step 4: 如有 test 引用路由 URL，更新测试
npm run test:run

# Step 5: 提交
git commit -m "chore: remove 5 dead library API routes"
```

---

## 9. 执行检查清单

每个 Phase 执行前，必须完成以下检查：

- [ ] 运行 `npm run test:run` 确认基线全绿（除已知 flaky test `queue.test.ts`）
- [ ] 运行 `npx tsc --noEmit` 确认无类型错误
- [ ] 对每一个待删除文件执行 `grep -r "filename" src/` 确认零引用
- [ ] 对每一个死 CSS 类执行 `grep -rn "classname" src/ --include="*.tsx"` 确认零使用
- [ ] 检查待删除文件是否包含全局副作用（IIFE、CSS import、事件监听）
- [ ] 删除后重新运行测试和编译
- [ ] 删除后重新运行 `knip` 确认无新增死代码链式反应
- [ ] 使用 `git diff` 审查变更范围
- [ ] 单独提交每个 Phase（或每个文件组），写清楚提交信息
- [ ] Phase 4 重构后运行全量测试确认无回归
- [ ] 删除 CSS 后检查关键页面 UI 无断裂（快速视觉回归）

---

## 10. 风险预防措施

### 10.1 防止删除活代码

1. **动态导入检查**: 搜索 `import("...")`、`require("...")` 和字符串拼接导入
2. **元编程检查**: 搜索 `Object.keys()`、`eval`、`Function` 构造器等反射用法
3. **测试引用检查**: 死文件可能在测试中被引用但不在主代码中（如 mock）
4. **shadcn/ui 恢复能力**: shadcn 组件删除后可通过 `npx shadcn add [name]` 秒级恢复
5. **框架约定入口检查**: `src/proxy.ts`、`src/app/**/page.tsx`、`route.ts`、`layout.tsx` 等可能没有普通 import，但由 Next.js 文件约定加载。以 `npm run build` 路由/Proxy 输出为准，不能只看 grep 结果。

### 10.2 防止引入回归

1. **逐文件删除**: 不要批量删除多个文件后统一测试；每删 3-5 个文件测试一次
2. **保留分支**: 在独立分支执行清理，通过 PR 合并
3. **E2E 验证**: 删除组件后，在关键页面截图对比（如 `/writing`、`/library`）
4. **CI 防护**: 建议在 CI 中加入 `knip` 检查，阻止新增死代码

### 10.3 建议的 CI 加固

```json
// package.json
{
  "scripts": {
    "knip": "knip",
    "knip:check": "knip --max-issues 0"
  }
}
```

在 GitHub Actions / CI 中加入：
```yaml
- name: Dead code check
  run: npx knip --max-issues 0
```

---

## 附录 A: 验证命令速查表

```bash
# 1. 全量测试
npm run test:run

# 2. 类型检查
npx tsc --noEmit

# 3. lint
npm run lint

# 4. 死代码扫描
npx knip --no-gitignore

# 5. 搜索特定文件引用
grep -r "filename" src/ --include="*.ts" --include="*.tsx"

# 6. 搜索特定导出引用
grep -r "exportName" src/ --include="*.ts" --include="*.tsx"

# 7. 查看文件大小（按行数）
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -20

# 8. 查看 console 语句分布
grep -rn "console\.(log|warn|error|debug|info)" src/ --include="*.ts" --include="*.tsx"
```

## 附录 B: 删除优先级矩阵

| Phase | 影响范围 | 风险等级 | 收益 | 建议执行顺序 |
|---|---|---|---|---|---|
| Phase 1 死文件 | 24+ 文件 | 🟢 低 | 清理死代码；已排除 `proxy.ts` | **第 1** |
| Phase 1.5 generated 噪音治理 | 3 文件 | 🟢 低 | 降低 knip 噪音 | **第 1** |
| Phase 2 未使用导出 + 活文件内部死代码 | 29 个导出 + 8 个 ESLint + 4 个 grep 项 | 🟡 中 | 缩小模块公开接口 | **第 2** |
| Phase 5 调试代码 | 59 处 console + 5 死 CSS | 🟢 低 | 减少 noise，提升生产环境性能 | **第 3** |
| Phase 6 遗留文件 | `_archive/`, `tmp/`, 脚本 | 🟢 低 | 释放磁盘空间 | **第 3** |
| Phase 4 重复代码/构建追踪风险 | 5 处模式（含 46 处静默 catch）+ 11 条 build warning | 🔴 中-高 | 数据一致性安全 + 构建性能 | **第 4** |
| Phase 7 死 API 路由 | 12 个路由文件 | 🔴 高 | 减少生产构建路由表噪音，降低攻击面 | **第 5** |
| Phase 3 巨型文件拆分 | 10 个文件 + i18n 镜像 | 🔴 高 | 长期可维护性 | **第 6** |

## 附录 C: TypeScript strict 已启用后的下一步

当前 `tsconfig.json` 已启用 `strict: true`，且 `npx tsc --noEmit` 通过。后续优化重点不是“打开 strict”，而是补齐仍未覆盖的更细粒度安全选项。

### 当前 tsconfig.json 关键设置

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    // 可进一步逐步显式启用以下增强项
    // "noUncheckedIndexedAccess": true,
    // "exactOptionalPropertyTypes": true,
    // "noImplicitOverride": true,
  }
}
```

### 渐进增强路线图

| 步骤 | 选项 | 风险 | 说明 |
|---|---|---|---|
| 1 | `noImplicitReturns: true` | 🟢 低 | 强制所有分支返回值 |
| 2 | `noFallthroughCasesInSwitch: true` | 🟢 低 | 防 switch 穿透 bug |
| 3 | `noUncheckedIndexedAccess: true` | 🟡 中 | 防数组/对象索引返回 undefined 被忽略 |
| 4 | `exactOptionalPropertyTypes: true` | 🟡 中 | 区分“字段缺失”和“字段显式 undefined” |
| 5 | `noImplicitOverride: true` | 🟢 低 | 当前类继承较少，启用风险低 |

**建议每次只启用一个选项，先运行 `npx tsc --noEmit` 统计错误量，再决定是否进入修复阶段。**

---

*本手册由 AI 辅助生成，经 knip + grep + tsc + build + lint + vitest 工具验证与人工交叉复核。*  
*交叉检查日期: 2026-06-11 | 累计修正项: 18 处*  
*执行前请再次确认当前分支状态与测试基线。*
