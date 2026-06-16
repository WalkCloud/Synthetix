# 中文支持设计文档

## 背景

当前产品按英文优先维护。运行时代码中不应再散落中文界面文案、提示词、占位符或错误信息。未来的中文能力应通过统一的国际化层引入，避免在组件、API 路由、hooks、worker 中直接硬编码中文。

## 目标

- 英文作为默认语言。
- 简体中文作为后续正式支持语言。
- 所有用户可见文案集中管理。
- LLM 提示词支持按语言切换，但不和 UI 文案混在一起。
- 用户语言偏好可持久化。
- 缺失翻译可以通过测试或 CI 检测出来。

## 非目标

- 不自动翻译用户上传或撰写的文档。
- 不把文档语言和界面语言绑定。
- 不在 React 组件、hooks、API 路由、worker 或测试中直接写中文字符串。
- 不上线半成品中文界面；翻译覆盖完整前不开放中文选项。

## 语言模型

使用 BCP 47 语言标识：

- `en`：英文，默认语言。
- `zh-CN`：简体中文，未来支持语言。

语言解析顺序建议：

1. 登录用户的数据库偏好。
2. 登录前或匿名状态下的浏览器本地存储。
3. `Accept-Language` 请求头，仅作为提示。
4. 默认回退到 `en`。

## 建议目录结构

```text
src/lib/i18n/
  context.tsx
  index.ts
  types.ts
  registry.ts
  locales/
    en.ts
    zh-CN.ts
  prompts/
    en.ts
    zh-CN.ts
```

`types.ts` 维护翻译 key 的类型契约。所有 locale 文件必须满足同一个结构。

`registry.ts` 维护语言列表、显示名称、默认语言、回退链和启用状态：

```ts
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export const DEFAULT_LOCALE = "en";
```

如果中文翻译未完成，`zh-CN` 可以存在于开发分支，但不要加入生产可选语言列表。

## UI 文案策略

所有用户可见文字都应迁移到翻译 key：

- 导航菜单。
- 按钮。
- tooltip。
- 空状态。
- toast 消息。
- 表单标签与校验消息。
- 状态标签。
- 弹窗标题与说明。

组件里只引用语义化 key：

```tsx
const { t } = useLocale();
return <button>{t.writing.generate}</button>;
```

key 不要直接复刻英文句子，优先使用语义命名，例如 `writing.generateAll`。

## API 错误策略

API 路由返回稳定错误码和英文兜底消息：

```json
{
  "success": false,
  "error": {
    "code": "ASSET_RENDER_FAILED",
    "message": "Failed to render the chart."
  }
}
```

客户端根据错误码本地化展示。服务端英文 message 主要用于日志、调试和非浏览器客户端。

## LLM 提示词本地化

LLM 提示词应独立于 UI 翻译。原因是提示词更长、更影响产品行为，需要单独评审。

建议暴露语言感知的构建函数：

```ts
buildFacilitatorPrompt(locale: Locale): string
buildOutlinePrompt(locale: Locale): string
buildWritingSystemPrompt(locale: Locale): string
```

规则：

- 英文提示词是默认和回退。
- 中文提示词不是简单翻译，需要按产品行为单独评审。
- 必要时仍要求模型使用用户输入语言回复。
- RAG 检索内容始终是内部上下文，任何语言下都不能向用户暴露。

## 文档语言与界面语言分离

文档语言和 UI 语言应分开：

- UI locale 控制界面文字。
- document language 控制生成内容语言。
- 用户输入语言可以作为默认推断，但用户应能手动覆盖。

后续可增加字段：

```ts
documentLanguage: "en" | "zh-CN" | "auto"
```

这样可以避免中文界面强制生成中文文档，也避免英文界面阻止用户写中文文档。

## 偏好持久化

短期：

- 登录前使用 local storage。
- 默认值固定为 `en`。

长期：

- 用户设置中增加 `preferredLocale`。
- 登录后同步 local storage 和数据库偏好。
- 根据解析后的 locale 更新 `<html lang>`。

## 测试与 CI

建议增加这些约束：

1. 源码扫描：除批准的中文 locale/prompt 文件外，运行时代码不得出现 CJK 字符。
2. key parity：`en` 和 `zh-CN` 必须有完全一致的 key。
3. 缺失翻译：启用语言中不允许空字符串或占位符。
4. UI 冒烟测试：切换语言后验证导航、Dashboard、写作页、设置页能正常渲染。
5. Prompt snapshot：不同语言的 prompt builder 输出符合预期。

推荐扫描规则：

```bash
rg "[\\p{Han}\\p{Hiragana}\\p{Katakana}\\p{Hangul}]" src --glob '!src/lib/i18n/locales/zh-CN.ts' --glob '!src/lib/i18n/prompts/zh-CN.ts'
```

## 推进步骤

1. 当前版本保持英文-only，清理运行时代码里的中文硬编码。
2. 扩展 `TranslationKeys`，覆盖所有用户可见 UI 文案。
3. 客户端展示错误改为基于错误码本地化。
4. 在功能分支中补齐 `zh-CN` locale 文件。
5. 为英文和中文分别建立 prompt builder。
6. 中文翻译覆盖完整后再开放语言切换入口。
7. 将语言偏好持久化到用户设置。
8. 在 CI 中启用 locale parity 和未授权 CJK 扫描。

## 验收标准

- 新用户和新浏览器默认显示英文。
- 运行时代码中没有未授权中文硬编码。
- 中文翻译完整前，用户不能选择中文界面。
- 后续增加中文不会要求复制业务逻辑或复制组件。
