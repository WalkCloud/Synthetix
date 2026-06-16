# Synthetix 中英文双语支持设计与实施方案

> 日期：2026-06-03  
> 范围：Next.js 前端、API 路由、用户偏好、LLM 提示词、文档生成流程、测试与验收  
> 状态：设计方案；本方案不修改运行时代码  
> 目标语言：`en` 英文、`zh-CN` 简体中文

---

## 一、代码现状分析

### 1. 已有国际化基础，但覆盖极低

当前已有轻量 i18n 模块：

- `src/lib/i18n/context.tsx`
- `src/lib/i18n/types.ts`
- `src/lib/i18n/locales/en.ts`
- `src/lib/i18n/index.ts`

现状特点：

- `Locale` 只有 `"en"`。
- 语言偏好只写入 `localStorage` 的 `synthetix-locale`。
- `TranslationKeys` 只覆盖侧边栏、用户菜单、About、语言名称。
- `Sidebar` 已经使用 `useLocale()`，但大部分页面和组件仍是硬编码英文。
- `RootLayout` 的 `<html lang="en">` 固定为英文。
- 字体只加载 `Plus_Jakarta_Sans` 和 `Inter` 的 latin subset，不适合中文长期展示。

结论：当前 i18n 是可扩展的雏形，但还不是完整双语体系。

### 2. 硬编码英文分布广

主要集中在这些模块：

| 区域 | 典型文件 | 问题 |
| --- | --- | --- |
| 登录/初始化 | `src/components/auth/login-form.tsx` | 左侧卖点、表单标题、错误提示、按钮文案全硬编码 |
| Layout | `src/components/layout/header.tsx`、`about-dialog.tsx` | 页面标题由调用方传字符串；AboutDialog 未使用已有 about 翻译 |
| Dashboard | `src/app/(dashboard)/page.tsx` | 卡片标题、空状态、最近文档/草稿文案硬编码 |
| Documents | `upload-zone.tsx`、`processing-settings.tsx`、`documents/page.tsx` | 上传区、处理设置、toast、模型说明硬编码 |
| Library/Search | `document-table.tsx`、`semantic-results.tsx`、`search/page.tsx` | 表格列、筛选、搜索阶段、confirm/alert 硬编码 |
| Writing | `writing/[id]/page.tsx`、`reference-panel.tsx`、各 writing hooks | 写作工作台、资产生成、toast、tooltip、状态文案硬编码 |
| Settings/Models | `settings/*.tsx`、`models/*.tsx` | 表单标签、帮助说明、连接测试、使用量分析硬编码 |
| 状态标签 | `src/lib/text/status-labels.ts`、`src/lib/dashboard/document-status.ts` | 状态英文和样式混在一起，不利于翻译 |

### 3. API 错误目前不可本地化

当前 `src/lib/api-helpers.ts`：

```ts
return NextResponse.json(
  { success: false, error: getErrorMessage(error) },
  { status }
);
```

API 多数直接返回英文字符串，例如：

- `"Unauthorized"`
- `"Draft not found"`
- `"Section not found"`
- `"No file provided"`
- `"Current password is incorrect"`

问题：

- 客户端只能展示服务端英文 message。
- 缺少稳定错误码，无法可靠映射中文。
- Zod 错误直接 flatten 后返回，也缺少前端翻译策略。

### 4. 用户语言偏好没有数据库字段

`prisma/schema.prisma` 的 `User` 目前没有 `preferredLocale` 字段。`src/lib/user-context.tsx` 返回的 `UserProfile` 也没有 locale。

现状影响：

- 用户换浏览器或清空 localStorage 后语言偏好丢失。
- 服务端无法根据用户偏好设置 `<html lang>`、metadata 或默认语言。
- 登录页、setup 页只能依赖浏览器或 localStorage。

### 5. LLM 提示词需要独立本地化

运行时 prompt 主要在：

- `src/lib/prompts/locales/*-prompts.ts`（facilitator prompt）
- `src/lib/brainstorm/outline-prompt.ts`
- `src/lib/writing/context.ts`
- `src/lib/writing/audit.ts`
- `src/lib/writing/humanizer.ts`
- `src/lib/documents/semantic-splitter.ts`
- `src/lib/writing/diagram-translate.ts`

现状特点：

- 大部分 prompt 是英文。
- 部分 prompt 通过 “same language as user” 控制输出语言。
- `docs/writing-prompts-zh.md` 已有中文提示词资料，但未接入运行时代码。

关键结论：Prompt 不能简单复用 UI 字典。提示词会改变模型行为，必须单独维护、单独测试、单独评审。

### 6. 文档语言与界面语言必须分离

当前写作系统天然支持用户写中文内容，因为 prompt 多处要求“保持用户语言”。但产品还没有明确区分：

- UI locale：界面语言。
- document language：生成文档语言。
- source language：上传文档/知识库内容语言。

如果直接把中文界面和中文生成绑定，会造成两个问题：

- 中文界面用户无法方便生成英文文档。
- 英文界面用户无法方便生成中文文档。

因此双语方案必须把这两类语言解耦。

---

## 二、目标与非目标

### 目标

1. 支持英文和简体中文两种界面语言。
2. 英文作为默认语言，中文作为正式可选语言。
3. 中文翻译专业、自然、符合中国用户对企业级工具的表达习惯。
4. 所有用户可见 UI 文案集中管理。
5. API 返回稳定错误码，客户端按 locale 显示本地化错误。
6. LLM prompt 支持按语言/文档语言构建，但独立于 UI 翻译。
7. 用户语言偏好可持久化到数据库，并兼容登录前 localStorage/cookie。
8. 通过测试保证 `en` 与 `zh-CN` key 完整一致。

### 非目标

1. 不自动翻译用户上传的文档内容。
2. 不自动翻译用户已经生成的草稿正文。
3. 不把 UI 语言强制绑定到文档生成语言。
4. 不引入重型国际化框架，除非后续 SSR/路由级 locale 需求明确升级。
5. 不在业务组件里直接硬编码中文。

---

## 三、推荐总体架构

### 1. 语言模型

使用 BCP 47：

```ts
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
```

解析优先级：

1. 登录用户的 `User.preferredLocale`。
2. `synthetix-locale` cookie，用于 SSR 和登录前页面。
3. `localStorage`，兼容现有实现。
4. `Accept-Language`，仅首次访问时作为提示。
5. 默认 `en`。

### 2. 目录结构

建议演进为：

```text
src/lib/i18n/
  constants.ts
  context.tsx
  format.ts
  index.ts
  keys.ts
  registry.ts
  server.ts
  types.ts
  locales/
    en.ts
    zh-CN.ts
  prompts/
    en.ts
    zh-CN.ts
    index.ts
  errors/
    en.ts
    zh-CN.ts
```

职责：

- `locales/*`：UI 文案。
- `errors/*`：API 错误码到用户可见文案的映射。
- `prompts/*`：LLM prompt 模板。
- `format.ts`：日期、数字、文件大小、相对时间格式化。
- `server.ts`：服务端解析 locale，设置 cookie，供 layout/API 使用。
- `registry.ts`：语言列表、显示名称、是否启用、回退链。

### 3. 翻译 key 结构

不要使用英文句子当 key，使用语义化 key。建议按产品区域拆分：

```ts
export interface TranslationSchema {
  common: {
    actions: {
      save: string;
      cancel: string;
      delete: string;
      edit: string;
      retry: string;
      confirm: string;
    };
    states: {
      loading: string;
      empty: string;
      failed: string;
      ready: string;
    };
  };
  layout: {
    sidebar: {...};
    userMenu: {...};
    about: {...};
  };
  auth: {...};
  dashboard: {...};
  documents: {...};
  library: {...};
  search: {...};
  writing: {...};
  brainstorm: {...};
  topology: {...};
  models: {...};
  settings: {...};
  errors: {...};
}
```

Locale 文件使用 `satisfies TranslationSchema`：

```ts
const zhCN = {
  common: {
    actions: {
      save: "保存",
      cancel: "取消",
    },
  },
} satisfies TranslationSchema;
```

这样 TypeScript 可以检查 key 缺失。

### 4. 翻译函数

当前 `t.sidebar.dashboard` 适合少量 key，但不适合带变量的句子。建议提供两种能力：

```ts
const { t, locale, setLocale, format } = useLocale();

t.common.actions.save
t.format("documents.uploadQueued", { count: 3 })
format.date(date)
format.relativeTime(date)
format.fileSize(bytes)
```

变量插值建议保持轻量，不引入 ICU 复杂语法：

```ts
"{count} documents queued for processing"
"已将 {count} 个文档加入处理队列"
```

---

## 四、中文翻译规范

### 1. 总体风格

中文界面应偏企业级工具风格：

- 准确、克制、清晰。
- 避免营销腔、口号化、过度拟人。
- 使用中国用户熟悉的产品表达。
- 技术名词该保留英文时保留英文。
- 操作按钮尽量短，说明文字可以完整。

### 2. 推荐术语表

| English | 推荐中文 | 说明 |
| --- | --- | --- |
| Dashboard | 工作台 | 比“仪表盘”更贴近当前产品 |
| Document Init | 文档初始化 | 适合上传与处理入口 |
| Document Library | 文档库 | 简洁自然 |
| Knowledge Search | 知识检索 | 比“知识搜索”更专业 |
| Mind Organization | 思路梳理 | 比“头脑风暴”更适合文档写作 |
| Document Writing | 文档撰写 | 专业自然 |
| Document Topology | 文档拓扑 | 技术用户可理解 |
| Model Management | 模型管理 | 标准译法 |
| User Management | 用户设置 | 当前页面实际是个人设置，不是后台用户管理 |
| Brainstorm | 思路梳理 | 产品语境优先 |
| Draft | 草稿 | 文档草稿 |
| Outline | 大纲 | 标准译法 |
| Section | 章节 | 写作语境优先，不译为“区段” |
| Reference | 参考资料 | 不用“引用”，避免误解为 citation |
| RAG | RAG | 保留英文缩写，说明中写“检索增强生成” |
| Knowledge Graph | 知识图谱 | 标准译法 |
| Embedding | Embedding / 向量嵌入 | 设置页可写“Embedding 模型” |
| Rerank | 重排序 | 标准译法 |
| Provider | 服务商 | 模型 provider 可译为“模型服务商” |
| Token | Token | 保留英文 |
| Prompt | Prompt / 提示词 | UI 用“提示词”，技术说明可保留 Prompt |
| Humanize | 润色 | 当前功能语境不建议译为“人性化” |
| Generate | 生成 | 标准译法 |
| Confirm | 确认 | 标准译法 |
| Lock Section | 锁定章节 | 写作状态语境 |
| Unlock | 解锁 | 标准译法 |
| Compare | 对比生成 | 写作页按钮可用 |
| Semantic Search | 语义检索 | 标准译法 |
| Keyword Search | 关键词检索 | 标准译法 |
| Processing | 处理中 | 状态 |
| Ready | 就绪 | 系统状态；文档可用也可用“已就绪” |
| Failed | 失败 | 状态 |

### 3. 中文按钮示例

| English | 中文 |
| --- | --- |
| Upload Files | 上传文件 |
| Upload Folder | 上传文件夹 |
| Start Processing | 开始处理 |
| Generate | 生成 |
| Generate All | 全部生成 |
| Stop | 停止 |
| Save Changes | 保存修改 |
| Change Password | 修改密码 |
| Test Connection | 测试连接 |
| Set as default model | 设为默认模型 |
| Remove default | 取消默认 |
| View full document | 查看完整文档 |
| Insert into section | 插入章节 |

### 4. 空状态示例

| English | 中文 |
| --- | --- |
| No documents yet | 暂无文档 |
| Upload your first document to get started. | 上传第一个文档后即可开始使用。 |
| No drafts yet | 暂无草稿 |
| Start by brainstorming an outline. | 先梳理一个大纲，然后创建草稿。 |
| No search results | 未找到匹配结果 |
| Try a different query or switch to keyword search. | 可以换个关键词，或切换为关键词检索。 |
| No knowledge graph yet. | 暂无知识图谱 |

### 5. 错误提示示例

| English | 中文 |
| --- | --- |
| Unauthorized | 未登录或登录已过期 |
| Draft not found | 未找到草稿 |
| Section not found | 未找到章节 |
| No file provided | 请选择要上传的文件 |
| File is empty | 文件内容为空 |
| Unsupported format | 暂不支持该文件格式 |
| Current password is incorrect | 当前密码不正确 |
| Network error, please try again | 网络异常，请稍后重试 |
| Generation failed | 生成失败 |
| Upload failed | 上传失败 |
| Export failed | 导出失败 |

中文错误提示原则：

- 告诉用户发生了什么。
- 尽量给下一步动作。
- 不暴露内部实现细节，如 stack、worker、route 名称。

---

## 五、API 本地化设计

### 1. 推荐响应格式

服务端应返回稳定错误码和英文 fallback message：

```json
{
  "success": false,
  "error": {
    "code": "DRAFT_NOT_FOUND",
    "message": "Draft not found",
    "details": {}
  }
}
```

客户端展示时：

1. 优先用 `error.code` 查本地化文案。
2. 找不到翻译时显示 `error.message`。
3. 开发环境可附加 details，生产环境不展示 details。

### 2. 错误码命名

建议按领域分类：

```ts
AUTH_UNAUTHORIZED
AUTH_INVALID_CREDENTIALS
USER_NOT_FOUND
DOCUMENT_NOT_FOUND
DOCUMENT_FILE_EMPTY
DOCUMENT_UNSUPPORTED_FORMAT
DRAFT_NOT_FOUND
SECTION_NOT_FOUND
MODEL_NOT_CONFIGURED
RAG_NOT_CONFIGURED
GENERATION_FAILED
EXPORT_FAILED
```

### 3. 兼容策略

短期保留旧格式：

```ts
type ApiError =
  | string
  | { code: string; message: string; details?: unknown };
```

客户端统一通过 helper 处理：

```ts
localizeApiError(error, t.errors)
```

这样不用一次性改完所有 API。

---

## 六、用户偏好与语言切换

### 1. 数据库字段

给 `User` 增加字段：

```prisma
preferredLocale String @default("en") @map("preferred_locale")
```

同时更新：

- `src/types/auth.ts`
- `src/lib/user-context.tsx`
- `src/app/api/v1/users/profile/route.ts`
- `src/components/settings/profile-tab.tsx`

### 2. Cookie 与 localStorage

使用同一个值同步：

- cookie：`synthetix-locale`，用于服务端读取和登录前页面。
- localStorage：保留现有 `synthetix-locale`，用于客户端快速恢复。
- 数据库：登录后权威偏好。

切换语言时：

1. 立即更新 React state。
2. 写入 cookie。
3. 写入 localStorage。
4. 如果已登录，调用 profile API 保存 `preferredLocale`。
5. 更新 `document.documentElement.lang`。

### 3. SSR 与 `<html lang>`

`RootLayout` 当前固定 `lang="en"`。建议改为服务端解析：

```tsx
const locale = await resolveRequestLocale();
<html lang={locale}>
```

中文时：

```html
<html lang="zh-CN">
```

---

## 七、字体与版式

### 1. 中文字体

当前 Google Font 只加载 latin，不适合中文。建议：

- 英文继续使用 `Inter` / `Plus Jakarta Sans`。
- 中文使用系统字体栈优先，不强依赖远程字体：

```css
--font-sans-zh: "Inter", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", sans-serif;
```

如需视觉一致，可后续引入 `Noto Sans SC`，但要评估包体和网络。

### 2. 中文排版注意事项

- 中文按钮通常更短，但说明文字可能更长。
- 表格列宽要避免英文宽度假设。
- 不要用 `uppercase` 处理中文分组标题。
- 日期不要固定 `en-US`。
- `letter-spacing` 不要负值。
- 文案容器要允许换行，避免长中文说明溢出。

---

## 八、LLM Prompt 本地化设计

### 1. 三种语言概念

```ts
interface LanguageContext {
  uiLocale: Locale;              // 界面语言
  documentLanguage: "auto" | Locale;
  userInputLanguage?: Locale;
}
```

规则：

- `uiLocale` 控制界面。
- `documentLanguage` 控制生成内容语言。
- `auto` 时根据草稿标题、用户输入和已有章节推断。
- 中文界面不强制生成中文文档。

### 2. Prompt 模块结构

```text
src/lib/i18n/prompts/
  index.ts
  en.ts
  zh-CN.ts
```

导出：

```ts
buildFacilitatorPrompt(language: PromptLanguage): string
buildOutlinePrompt(language: PromptLanguage): string
buildWritingSystemPrompt(language: PromptLanguage): string
buildAuditPrompt(language: PromptLanguage): string
buildHumanizerPrompt(language: PromptLanguage): string
buildSemanticSplitPrompt(language: PromptLanguage): string
```

### 3. 中文 Prompt 不是逐句翻译

中文 prompt 应按中国专业文档写作习惯重写：

- 政企文档常见结构：背景与必要性、现状分析、总体方案、实施路径、保障措施。
- 技术方案常见结构：需求分析、总体架构、详细设计、安全与运维、实施计划。
- 咨询/评估文档强调：范围、依据、方法、发现、结论、建议。

已有 `docs/writing-prompts-zh.md` 可作为资料输入，但运行时 prompt 应拆成 builder 并配测试快照。

### 4. 输出语言控制

写作 prompt 应明确：

```text
Write the final section in {documentLanguage}. If documentLanguage is auto, infer it from the draft title, outline, user requirements, and existing section content.
```

中文版本：

```text
请使用 {documentLanguage} 撰写最终章节内容。若 documentLanguage 为 auto，则根据草稿标题、大纲、用户要求和已有章节内容判断。
```

---

## 九、实施路线

### Phase 0：基础设施准备

目标：不改变 UI 行为，只建立可扩展基础。

任务：

1. 新增 `Locale = "en" | "zh-CN"`。
2. 新增 `registry.ts`、`constants.ts`、`format.ts`。
3. 新增 `zh-CN.ts`，先只覆盖当前已有 key。
4. 扩展 `language` 字典：`en: "English"`、`zhCN: "简体中文"`。
5. 语言菜单显示中文选项，但可通过 feature flag 控制是否开放。
6. 增加 locale key parity 测试。

验收：

- 现有英文 UI 不变。
- TypeScript 能检查 `en` 和 `zh-CN` key 结构一致。
- 语言切换不会导致 hydration warning。

### Phase 1：Layout、登录页、基础通用组件

优先迁移用户第一眼看到的界面。

范围：

- `RootLayout` metadata / html lang。
- `Sidebar` 完善双语菜单。
- `AboutDialog` 使用已有 about key。
- `Header` 改为接收 `titleKey` 或页面自己传本地化字符串。
- `LoginForm`。
- `EmptyState`、`LoadingState`、`StatusBadge` 等共享组件。

验收：

- 登录页、主导航、About、Dashboard title 可双语切换。
- 中文文案专业自然，无英文残留的主要入口。

### Phase 2：Dashboard、Documents、Library、Search

这是中文用户核心工作流。

范围：

- `src/app/(dashboard)/page.tsx`
- `src/app/(dashboard)/documents/page.tsx`
- `src/components/documents/*`
- `src/app/(dashboard)/library/page.tsx`
- `src/components/library/*`
- `src/app/(dashboard)/search/page.tsx`
- `src/components/topology/*` 的空状态和控制区

特别处理：

- `confirm()` / `alert()` 改为可本地化 dialog/toast。
- 搜索阶段文案迁移到 `search.stages.semantic[]` / `search.stages.keyword[]`。
- 状态标签从 `label` 字符串改为状态 key + 翻译。

验收：

- 上传、处理、文档库、搜索完整流程无主要英文 UI 文案。
- 日期、文件大小、百分比按 locale 格式化。

### Phase 3：Settings、Models、Profile

范围：

- `src/components/settings/*`
- `src/components/models/*`
- `src/components/settings/profile-tab.tsx`
- `src/app/api/v1/users/profile/route.ts`
- Prisma migration 增加 `preferredLocale`

特别处理：

- 把语言选择放到用户设置中。
- 模型能力名称、usage analytics 模块名、连接测试结果本地化。
- 中国用户友好表达：
  - “模型服务商”
  - “上下文窗口”
  - “Embedding 维度”
  - “默认模型”
  - “用量统计”

验收：

- 用户偏好保存到数据库。
- 刷新页面、重新登录后语言保持。

### Phase 4：Writing 与 Brainstorm

范围：

- `src/app/(dashboard)/brainstorm/page.tsx`
- `src/hooks/brainstorm/*`
- `src/app/(dashboard)/writing/page.tsx`
- `src/app/(dashboard)/writing/[id]/page.tsx`
- `src/components/writing/*`
- `src/hooks/writing/*`

特别处理：

- UI 文案迁移到 locale。
- 文档生成语言新增独立设置：
  - `auto`
  - `en`
  - `zh-CN`
- 写作页约束栏增加“文档语言”选择，但不要和 UI 语言绑定。
- toast、SSE 错误、模型对比错误本地化。

验收：

- 中文界面下可以生成英文草稿。
- 英文界面下可以生成中文草稿。
- 章节状态、对比生成、润色、审计、导出 UI 全部双语。

### Phase 5：API 错误码体系

范围：

- `src/lib/api-helpers.ts`
- 所有 API route 中的 `errorResponse("...")`
- 前端 `toast.error(data.error || "...")`

策略：

1. 先让 `errorResponse` 支持 `{ code, message, details }`。
2. 旧字符串路径保留兼容。
3. 前端统一 `getLocalizedError(data.error, t.errors)`。
4. 逐步把高频 API 改成错误码。

验收：

- 常见错误不再直接展示英文服务端 message。
- 未翻译错误仍有英文 fallback。

### Phase 6：Prompt 本地化

范围：

- Brainstorm facilitator prompt。
- Outline generation prompt。
- Writing context prompt。
- Audit prompt。
- Humanizer prompt。
- Semantic splitter prompt。
- Diagram translate prompt。

验收：

- Prompt builder 有 `en` / `zh-CN` 快照测试。
- 中文 prompt 输出结构和英文一致。
- 对中文用户更自然，不只是英文 prompt 的直译。

### Phase 7：测试、CI、发布开关

新增测试：

1. locale key parity。
2. 未授权 CJK 扫描：运行时代码除 `zh-CN` locale/prompt 外不出现中文硬编码。
3. UI smoke：登录、Dashboard、Documents、Library、Writing、Settings 双语渲染。
4. API error localization。
5. Prompt snapshot。

发布策略：

- 开发环境可显示中文选项。
- 生产环境只有当 key 覆盖率达标、核心流程测试通过后开放中文。

---

## 十、优先翻译清单

### 第一批必须覆盖

- Login / setup。
- Sidebar / Header / About。
- Dashboard。
- Documents upload + processing settings。
- Library table and filters。
- Search + knowledge graph empty/loading states。
- Settings profile language selector。
- Common actions and statuses。

### 第二批覆盖

- Writing editor。
- Reference panel。
- Asset generation。
- Compare generation。
- Full draft generation。
- Export。
- Brainstorm flow。

### 第三批覆盖

- Model management。
- Usage analytics。
- Storage / Database / RAG advanced settings。
- API errors 全量替换。
- Prompt 全量本地化。

---

## 十一、验收标准

### 功能验收

- 用户可在菜单或设置中切换 English / 简体中文。
- 刷新页面后语言保持。
- 登录后跨浏览器可恢复用户语言偏好。
- `<html lang>` 与当前语言一致。
- 中文界面下仍可生成英文文档。
- 英文界面下仍可生成中文文档。

### 文案验收

- 中文翻译完整覆盖核心工作流。
- 中文表达专业、自然、适合中国用户。
- 技术词汇使用统一术语表。
- 不出现中英混杂的半成品界面，专有名词除外。

### 工程验收

- `en` 与 `zh-CN` key 完全一致。
- 启用语言不允许空字符串。
- 运行时代码无未授权中文硬编码。
- API 错误具备稳定错误码。
- Prompt builder 有快照测试。
- `pnpm lint`、`pnpm test:run`、`pnpm build` 通过。

---

## 十二、风险与控制

| 风险 | 控制 |
| --- | --- |
| 一次性迁移范围过大 | 按页面分批迁移，先核心工作流 |
| 中文 prompt 改变模型行为 | prompt 单独快照测试，先灰度启用 |
| API 错误改造影响调用方 | 保留旧字符串兼容，逐步替换 |
| 中文翻译不专业 | 建立术语表和文案评审清单 |
| layout SSR 与 client localStorage 不一致 | 使用 cookie 作为服务端可读语言来源 |
| 中文字体导致页面布局变化 | 迁移时检查按钮、表格、窄屏和长文案换行 |

---

## 十三、建议最终实施顺序

1. 建立 i18n registry、`zh-CN` locale、format helper、key parity test。
2. 加入 cookie + localStorage 双写，保持现有英文默认行为。
3. 迁移 Layout、Login、Dashboard。
4. 增加 `User.preferredLocale` 并接入用户设置。
5. 迁移 Documents、Library、Search。
6. 迁移 Settings、Models。
7. 迁移 Writing、Brainstorm。
8. 改造 API 错误码与本地化展示。
9. 拆分并本地化 LLM prompts。
10. 开启 CI 扫描和生产中文开关。

该顺序能先交付用户可见的双语体验，同时控制写作 prompt 和 API 错误体系这两类高风险改动。
