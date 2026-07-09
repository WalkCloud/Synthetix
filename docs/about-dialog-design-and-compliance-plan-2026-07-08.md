# About 与开源合规设计开发方案

> 日期：2026-07-08  
> 状态：设计草案（修订版 r2），待讨论确认  
> 范围：Synthetix About 弹窗、第三方开源组件展示、许可证与打包合规  
> 相关代码：`src/components/layout/about-dialog.tsx`、`src/lib/i18n/*`、`scripts/build-installer.mjs`、`scripts/build-electron.mjs`、`electron-builder.yml`
>
> ## 修订说明
>
> 本版（r2）根据与代码库的交叉检查修订了以下内容：
>
> - **修正 `stripDocs` 作用范围**：原稿将其描述为会删除"部分依赖包"中的许可证文件，实际只对 `next`、`react`、`react-dom`、`effect` 四个白名单包生效（`build-installer.mjs:673-679`）。相关风险描述与 Phase 4 重点已重新定位。
> - **补充 electron-builder 配置层**：原稿变更清单遗漏了 `build-electron.mjs` 与 `electron-builder.yml`。实际安装包通过 `extraResources: dist/app → resources/app` 打包，notices 必须落在 `dist/app/` 内才能进入安装包，且安装后位于 `resources/app/` 下而非安装根目录。
> - **修正 `generate:notices` 挂载点**：从 `npm run build`（即 `next build`）改为 `build-installer.mjs` 的 assemble 阶段。
> - **明确 `app-metadata.ts` 的 git 策略**：原稿未处理该文件含 `buildTime` 时间戳导致的脏工作区问题。
> - **次要修正**：版权年份改为动态、明确 `Export Notices` 下载机制、补全 i18n key 枚举、补全 `stripDocs` 实际正则。

## 1. 背景

当前 About 弹窗只展示应用名、硬编码版本号、技术栈一句话和版权声明。它能满足基础“关于”入口，但不足以支撑桌面分发和开源合规：

- `src/components/layout/about-dialog.tsx` 中 `APP_VERSION = "0.5.3.0"` 与 `package.json` 的 `1.0.1` 不一致。
- About 文案只覆盖标题、副标题、版本、技术栈、版权，不支持开源组件、许可证、构建信息和第三方声明。
- `scripts/build-installer.mjs` 的 `stripDocs` 会删除白名单包中的 `LICENSE`、`LICENCE`、`NOTICE`、`README`、`CHANGELOG`、`HISTORY`、`AUTHORS`、`CONTRIBUTORS`、`PATENTS` 等文件。当前 `stripDocs` 仅对 `next`、`react`、`react-dom`、`effect` 四个包生效（`build-installer.mjs:673-679`），作用范围有限；真正的合规缺口在于项目从未生成过聚合的 `THIRD-PARTY-NOTICES.txt`，也没有把项目自身 `LICENSE` 与第三方声明纳入安装包分发物。
- 项目自身使用 Apache-2.0，但当前 About 的 “All rights reserved / 保留所有权利” 与开源许可表达不够一致。

本方案目标是把 About 从“简单信息弹窗”升级为“产品身份 + 版本信息 + 开源合规入口”的可信信息中心，同时把许可证合规纳入构建产物。

## 2. 参考模式

主流桌面和开发者工具通常采用两层结构：

1. About 主界面只放用户最关心的信息：产品名、版本、构建号、版权、许可证入口。
2. 第三方依赖和许可证放到独立页面、文件或二级弹窗中，避免主界面过载。

参考依据：

- VS Code 使用独立 `ThirdPartyNotices.txt` 列出第三方组件、版本、来源和许可证文本：<https://raw.githubusercontent.com/microsoft/vscode/main/ThirdPartyNotices.txt>
- Apache License 2.0 第 4 节要求再分发时提供许可证副本，并在上游包含 `NOTICE` 时保留可读归属声明：<https://www.apache.org/licenses/LICENSE-2.0>
- MIT License 要求 copyright notice 和 permission notice 随软件副本或实质部分一起包含：<https://opensource.org/license/mit>

## 3. 设计目标

### 3.1 用户体验目标

- 用户打开 About 后能立即理解 Synthetix 是什么、当前版本是什么、是否开源、采用什么许可证。
- 技术栈和核心开源组件只展示“代表性依赖”，不把 About 变成依赖清单。
- 完整开源声明必须可访问、可搜索、可复制、可导出。
- 中文和英文 About 信息保持同等完整度。

### 3.2 工程目标

- 版本号不能硬编码，应从单一来源注入。
- 构建信息可追溯，包括版本、构建时间、git commit short hash。
- 第三方许可证清单应由脚本生成，不靠手工维护。
- Windows 安装包必须包含项目自身 `LICENSE` 和完整第三方声明。
- 打包裁剪不能破坏合规材料。

### 3.3 合规目标

- 保留 Synthetix 自身 Apache-2.0 许可证。
- 对 MIT、Apache-2.0、ISC、BSD 等宽松许可证依赖，随分发物保留版权声明和许可证文本。
- 对包含 `NOTICE` 的 Apache-2.0 依赖，保留其 NOTICE 内容或汇总到第三方声明中。
- 对 Python worker 依赖、Electron 依赖、模型/字体/图标等非 npm 资产一并纳入审计范围。

## 4. 当前 About 现状

入口：

- 侧边栏用户菜单 `src/components/layout/sidebar.tsx`
- 弹窗组件 `src/components/layout/about-dialog.tsx`

当前展示内容：

| 区域 | 当前状态 | 问题 |
| --- | --- | --- |
| Logo + 标题 | 已有 | 可保留 |
| 副标题 | 已有 | 文案偏泛，未体现 local-first、large-document、knowledge graph |
| 版本 | 硬编码 `0.5.3.0` | 与 `package.json` 不一致 |
| 技术栈 | 一句话 | 缺少核心组件、许可证入口 |
| 版权 | `All rights reserved` | 与 Apache-2.0 开源表达不一致 |
| 开源组件 | 无 | 不满足用户对开源组件透明度的预期 |
| 第三方许可证 | 无 | 不适合桌面安装包分发 |

## 5. 推荐信息架构

采用“About 主弹窗 + Third-party Notices 二级界面”的结构。

### 5.1 About 主弹窗

建议宽度：`sm:max-w-[620px]` 左右。内容保持可扫读，不超过一屏半。

信息区块：

1. 产品身份
   - Logo
   - `Synthetix`
   - 中文副标题：`本地优先的超大文档知识处理与长文档写作工作台`
   - 英文副标题：`Local-first AI workbench for large-document knowledge and long-form writing`

2. 版本与构建信息
   - App version：来自 `package.json`
   - Build：构建时间，例如 `2026-07-08 19:55`
   - Commit：git short hash，开发环境可显示 `dev`
   - Runtime：`Next.js 16 · React 19 · Python workers`

3. 产品特点
   - `Large-document processing`
   - `RAG / Wiki / Knowledge Graph`
   - `Local-first storage`
   - `Encrypted provider keys`
   - `Bilingual UI`

4. 代表性开源组件
   - Next.js / React
   - Prisma / SQLite / PostgreSQL adapter
   - LightRAG / Docling
   - d3-force
   - Electron
   - Tailwind CSS / shadcn / Base UI

5. 法律与开源入口
   - `Synthetix is licensed under Apache License 2.0.`
   - `This application includes third-party open-source software.`
   - 按钮：
     - `View Synthetix License`
     - `Third-party Notices`
     - `Export Notices`：通过 `public/legal/THIRD-PARTY-NOTICES.txt` 静态路径直链下载（`<a href="/legal/THIRD-PARTY-NOTICES.txt" download>`），无需 API route。Web 端和 Electron 端均适用，因为该文件随 `public/` 打包并经 `extraResources` 进入安装包 `resources/app/public/legal/`。

### 5.2 Third-party Notices 二级界面

可选实现形态：

| 方案 | 说明 | 推荐度 |
| --- | --- | --- |
| 独立页面 `/legal/third-party-notices` | 适合长清单、搜索、复制、导出 | 高 |
| 二级 Dialog | 实现快，但长文本体验一般 | 中 |
| 直接打开文本文件 | 桌面端简单可靠，但 Web 端体验弱 | 中 |

建议采用独立页面，同时 About 弹窗中保留入口。

页面功能：

- 搜索包名、许可证、来源。
- 按许可证筛选：Apache-2.0、MIT、ISC、BSD、Other。
- 表格展示：包名、版本、许可证、来源、运行时类别。
- 展开后显示完整许可证文本、copyright、NOTICE。
- 提供 `Copy all` 和 `Download THIRD-PARTY-NOTICES.txt`。

## 6. 视觉设计方向

Synthetix 是面向专业文档处理和知识工作的工具，About 应该偏“稳、清晰、可信”，不是营销页。

建议：

- 保持现有 Dialog、Tailwind、shadcn 风格，不引入新的 UI 框架。
- 使用紧凑信息卡片，但不要卡片套卡片。
- 用 `lucide-react` 图标表达入口：`Info`、`Scale`、`PackageOpen`、`Download`、`ExternalLink`、`Copy`。
- 产品特点使用小型 pill 或两列列表，避免大面积宣传式卡片。
- 许可证入口使用普通按钮，不使用渐变按钮。
- 文本层级：
  - 产品名：`text-xl`
  - 副标题：`text-sm text-muted-foreground`
  - 字段标签：`text-xs text-muted-foreground`
  - 版本值：`font-mono text-sm`

## 7. 数据模型与文件设计

### 7.1 应用元信息

新增构建期生成文件：

```ts
// src/generated/app-metadata.ts
export const appMetadata = {
  name: "Synthetix",
  version: "1.0.1",
  license: "Apache-2.0",
  buildTime: "2026-07-08T11:55:00.000Z",
  commit: "abc1234",
};
```

生成来源：

- `package.json`：`name`、`version`、`license`
- `git rev-parse --short HEAD`：commit
- 当前 UTC 时间：buildTime

#### 7.1.1 git 跟踪策略（必须明确）

`buildTime`（UTC 时间戳）每次构建都变化，若 git 跟踪该文件会带来两个问题：工作区永远 dirty、产生无意义的 commit 噪声。必须在以下两种策略中明确选择，推荐策略 A：

| 策略 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A（推荐）拆分静态/动态** | `version`、`name`、`license` 在构建期从 `package.json` 注入到 git 跟踪的 `src/generated/app-version.ts`；`buildTime`、`commit` 不写入文件，改为运行时读取（Next.js 通过 `generateBuildId` 或自定义注入）或写入 git-ignore 的 `src/generated/build-info.ts` | 静态版本可 review，动态信息不污染工作区 | 需两套机制 |
| B 全部 git-ignore | 整个 `app-metadata.ts` 加入 `.gitignore`，干净 checkout 下走 fallback | 实现简单 | 干净 checkout 下版本退化、commit 显示 `dev` |

推荐采用策略 A：把"几乎不变"的 `version/name/license` 与"每次构建必变"的 `buildTime/commit` 分离。`src/generated/` 目录已存在（当前含 `prisma/`），可复用。

开发环境 fallback：

- 若静态版本文件不存在，运行时读取 `package.json` 的 `version`。
- 若 `buildTime`/`commit` 不可用（dev 环境），`commit` 显示 `dev`，`buildTime` 显示构建时刻或省略。

### 7.2 第三方声明数据

建议生成两个产物：

```text
public/legal/third-party-notices.json
public/legal/THIRD-PARTY-NOTICES.txt
```

JSON 用于页面展示，TXT 用于下载和随安装包分发。

JSON 结构：

```ts
type ThirdPartyNotice = {
  name: string;
  version: string;
  license: string;
  homepage?: string;
  repository?: string;
  source: "npm" | "python" | "electron" | "asset" | "runtime";
  copyright?: string[];
  licenseText?: string;
  noticeText?: string;
};
```

## 8. 开源合规策略

### 8.1 必须覆盖的依赖来源

| 来源 | 示例 | 获取方式 |
| --- | --- | --- |
| npm 生产依赖 | Next.js、React、Prisma、d3-force、zod | 读取 `node_modules/**/package.json` 与 lockfile |
| npm 传递依赖 | Next/SWC、Prisma runtime 等 | 从实际打包 `node_modules` 扫描 |
| Electron | Electron runtime、electron-builder 相关运行材料 | 扫描 Electron 打包产物 |
| Python worker | docling、lightrag-hku、onnxruntime、transformers | `pip-licenses` 或扫描 site-packages metadata |
| 静态资产 | Logo、字体、图标、模型 | 手工维护 asset notice manifest |
| 本项目 | Synthetix | 根目录 `LICENSE` |

### 8.2 宽松许可证处理规则

| 许可证 | 处理要求 |
| --- | --- |
| MIT | 保留 copyright notice 和 permission notice |
| Apache-2.0 | 保留许可证文本；如上游有 NOTICE，保留 NOTICE 归属声明 |
| ISC | 保留版权与许可文本 |
| BSD-2/BSD-3 | 保留版权、许可条件和免责声明 |
| MPL/LGPL/GPL/AGPL | 若出现，阻断发布并人工审查 |
| Unknown/Custom | 阻断发布并人工审查 |

### 8.3 打包脚本调整

合规保障的主线是 **Phase 3 的聚合声明文件**，而非 `stripDocs` 的微调。原因：当前 `stripDocs` 仅对 `next`、`react`、`react-dom`、`effect` 四个白名单包生效（`build-installer.mjs:673-679`），作用范围有限；即便保留这四个包的原始 LICENSE 文件，其余数百个依赖的许可证仍需通过聚合的 `THIRD-PARTY-NOTICES.txt` 统一提供。`stripDocs` 调整属于降低风险的辅助措施。

当前 `stripDocs`（`build-installer.mjs:685-719`）的实际正则：

```text
文件名前缀：license|licence|changelog|readme|authors|contributors|notice|history|patents
扩展名：.md .markdown .map .ts .flow .coffee
```

注意：`.ts` 扩展名匹配会删除包内的 `.d.ts` 声明文件（代码注释曾讨论过保留但当前正则仍会删除），某些类型解析器可能受影响。建议改为：

- 永远保留：`LICENSE`、`LICENCE`、`NOTICE`、`PATENTS`、`AUTHORS`、`CONTRIBUTORS`
- 可裁剪：`README`、`CHANGELOG`、`HISTORY`、`.md` 文档、`.map`、源码类型文件
- 若确实需要删除许可证原文件，必须先证明 `THIRD-PARTY-NOTICES.txt` 已包含完整等价内容。
- 建议把 `stripDocs` 正则中的 `\.ts` 从裁剪名单移除，避免误删 `.d.ts`。

#### 8.3.1 electron-builder 配置层（关键）

打包流程分两步，notices 必须在第一步就位：

1. `node scripts/build-installer.mjs --assemble-only` → 组装 `dist/app/`（node.exe + CPython + .next + node_modules + workers + prisma）。
2. `node scripts/build-electron.mjs`（即 `pnpm electron:build`）→ 编译 `electron/*.ts`，调用 `electron-builder --win nsis`，读取 `electron-builder.yml` 生成 `.exe`。

`electron-builder.yml` 的 `extraResources`（当前第 76-81 行）把 **整个 `dist/app` verbatim** 复制到安装包的 `resources/app/`，filter 为 `**/*`。因此：

- **notices 文件只要落在 `dist/app/` 内部，就会自动进入安装包**，无需额外修改 `electron-builder.yml` 的 `extraResources`。
- 但需要核对 `electron-builder.yml` 的 `files` allowlist（第 37-70 行）不会拦截 notices——当前 `files` 只控制 `app.asar` 内容（仅编译后的 electron main），不涉及 `extraResources`，所以不冲突。
- **安装后路径**：notices 落在 `%LOCALAPPDATA%\Programs\Synthetix\resources\app\` 下（如 `resources/app/LICENSE`、`resources/app/THIRD-PARTY-NOTICES.txt`），而非安装根目录。若希望用户在安装根目录也能看到，需在 `electron-builder.yml` 额外配置顶层 `extraResources` 把 LICENSE 复制到安装根。当前方案默认只放在 `resources/app/` 下，通过 About 弹窗入口访问，不在安装根目录冗余放置。

#### 8.3.2 安装包必须包含的文件

```text
dist/app/LICENSE
dist/app/THIRD-PARTY-NOTICES.txt
dist/app/public/legal/third-party-notices.json
dist/app/public/legal/THIRD-PARTY-NOTICES.txt
```

这些文件在 `build-installer.mjs` 的 assemble 阶段写入 `dist/app/`，随后经 `electron-builder.yml` 的 `extraResources: dist/app → app` 进入安装包的 `resources/app/`。

#### 8.3.3 验证安装包内容

发布前解包验证：用 7-Zip 打开 `Synthetix Setup <ver>.exe`，确认 `$PLUGINSDAT`/`resources/app/` 下存在上述四个文件；或安装后在 `%LOCALAPPDATA%\Programs\Synthetix\resources\app\` 检查。

## 9. 实施计划

### Phase 1：About 主弹窗重构

目标：修复版本不一致，升级主弹窗信息架构。

任务：

- 删除 `APP_VERSION = "0.5.3.0"` 硬编码。
- 新增应用元信息读取方式。
- 扩展 `TranslationSchema.layout.about`，新增以下 key（中英文同步）：
  - `subtitle`（更新现有值，体现 local-first / large-document / knowledge graph 定位）
  - `build`（构建时间标签）
  - `commit`（git short hash 标签）
  - `runtime`（运行时标签，如 `Next.js 16 · React 19 · Python workers`）
  - `features`（产品特点列表，如 Large-document processing 等）
  - `licenseStatement`（Apache-2.0 声明文案）
  - `thirdPartyIntro`（包含第三方开源软件的说明）
  - `actions.viewLicense`（`View Synthetix License`）
  - `actions.thirdPartyNotices`（`Third-party Notices`）
  - `actions.exportNotices`（`Export Notices`）
  - `copyright`（更新现有值，改为 Apache-2.0 友好表达，去掉"保留所有权利"）
- 更新 `zh-CN.ts` 和 `en.ts`。
- 重构 `AboutDialog` 布局。
- 将版权文案改为 Apache-2.0 友好表达。

验收标准：

- About 显示版本与 `package.json` 一致。
- 中英文界面信息完整。
- 弹窗在桌面和窄屏下不溢出。
- Playwright 导航测试仍可打开 About。

### Phase 2：第三方声明页面

目标：提供可访问、可搜索、可导出的第三方开源组件清单。

任务：

- 新增 `/legal/third-party-notices` 页面。
- 新增 notices JSON 读取逻辑。
- 增加搜索和许可证筛选。
- 增加复制和下载入口。
- About 弹窗跳转到该页面。

验收标准：

- 页面可列出 npm、Python、Electron、asset 四类依赖。
- 搜索包名和许可证可用。
- TXT 下载内容与 JSON 数据一致。
- 空数据或生成失败时有明确错误状态。

### Phase 3：许可证清单生成脚本

目标：让第三方声明自动生成，避免手工遗漏。

任务：

- 新增 `scripts/generate-third-party-notices.mjs`。
- 扫描 npm 实际生产依赖。
- 扫描 Python worker 依赖 metadata。
- 读取手工资产 manifest，例如 `legal/assets-notices.json`。
- 输出 JSON 和 TXT。
- 在 `build-installer.mjs` 的 assemble 阶段开头执行（见 8.3.1），而非 `npm run build`（`next build` 不涉及安装包打包，挂在那里不会生效）。

建议脚本命令：

```json
{
  "scripts": {
    "generate:notices": "node scripts/generate-third-party-notices.mjs"
  }
}
```

> 挂载点说明：`build-installer.mjs` 不是 npm script（`package.json` 中没有 `build-installer` 条目），它通过 `node scripts/build-installer.mjs` 直接运行。`generate:notices` 作为独立 npm script 便于本地手动执行，但在打包流程中应由 `build-installer.mjs` 内部调用，确保产物写入 `dist/app/` 后才进入 `extraResources` 复制。

验收标准：

- 脚本可重复运行。
- 缺少许可证、未知许可证、copyleft 许可证时返回非零退出码或明确警告。
- 输出文件被 git 跟踪，或在构建产物中强制生成。
- 生成内容包含包名、版本、许可证、来源、许可证文本。

### Phase 4：打包合规修复

目标：确保 Windows 安装包分发时带齐许可证材料。

> 权重说明：本 Phase 的核心是**确保聚合声明文件进入安装包**，而非 `stripDocs` 调整。合规保障的主线是 Phase 3 生成的 `THIRD-PARTY-NOTICES.txt` 落入 `dist/app/` 并经 `electron-builder.yml` 的 `extraResources` 打入安装包。`stripDocs` 仅影响 4 个包，属于辅助措施。

任务：

- 修改 `scripts/build-installer.mjs`，在 assemble 阶段开头调用 `generate:notices`（或直接 require 脚本逻辑），并将产物写入 `dist/app/`：
  - `dist/app/LICENSE`（复制项目根 `LICENSE`）
  - `dist/app/THIRD-PARTY-NOTICES.txt`
  - `dist/app/public/legal/third-party-notices.json`
  - `dist/app/public/legal/THIRD-PARTY-NOTICES.txt`
- 修改 `stripDocs`，把许可证相关文件名（`license`、`licence`、`notice`、`patents`）从裁剪名单移除（辅助措施，见 8.3）。
- **核对 `electron-builder.yml`**：确认 `extraResources: dist/app → app`（filter `**/*`）会带走新增文件——当前配置无需改动即可覆盖，但需验证 `files` allowlist 不冲突。
- 安装后 notices 位于 `resources/app/` 下（见 8.3.1），通过 About 入口访问。
- About 中的 `Export Notices` 能获取同一份文件。

验收标准：

- `dist/app` 中存在 `LICENSE` 和 `THIRD-PARTY-NOTICES.txt`。
- **安装包解包后，`resources/app/` 下存在同样文件**（用 7-Zip 打开 `.exe` 验证，或安装后检查 `%LOCALAPPDATA%\Programs\Synthetix\resources\app\`）。
- 裁剪后不删除许可证和 NOTICE 文件。
- 构建日志明确显示 notices 已生成并写入 `dist/app/`。

### Phase 5：测试与文档

任务：

- 更新 `e2e/navigation.spec.ts` 中 About 相关断言。
- 增加 notices 生成脚本单元测试或 smoke test。
- 更新 README 的 License 或 Distribution 部分。
- 在 `docs/release-workflow.md` 增加发布前合规检查。

验收标准：

- `npm test` 通过。
- `npm run build` 通过。
- `npm run generate:notices` 通过，产物写入 `dist/app/`（由 `build-installer.mjs` 调用时）。
- Playwright smoke 测试覆盖 About 与 third-party notices 页面。

## 10. 推荐文案

### 10.1 中文

```text
关于 Synthetix
本地优先的超大文档知识处理与长文档写作工作台。

Synthetix 使用 Apache License 2.0 发布，并包含第三方开源软件。
完整许可、版权和归属声明请查看第三方开源声明。

Copyright © {year} Synthetix contributors. Licensed under Apache License 2.0.
```

### 10.2 English

```text
About Synthetix
Local-first AI workbench for large-document knowledge and long-form writing.

Synthetix is licensed under Apache License 2.0 and includes third-party open-source software.
See Third-party Notices for complete license, copyright, and attribution information.

Copyright © {year} Synthetix contributors. Licensed under Apache License 2.0.
```

> `{year}` 在运行时由 `new Date().getFullYear()` 动态注入（与现有 `about-dialog.tsx:55` 实现一致），不硬编码年份。

## 11. 风险与决策点

### 11.1 需要确认的产品决策

| 决策 | 推荐 | 原因 |
| --- | --- | --- |
| Third-party Notices 形态 | 独立页面 | 长清单更适合搜索、复制和下载 |
| 是否显示全部依赖在 About | 不显示 | 主弹窗保持清晰，完整清单放二级页面 |
| 是否将 notices 文件纳入 git | 倾向纳入 | 便于 review 许可证变化，但会增加 diff |
| 是否阻断 unknown license 构建 | 发布构建阻断，开发构建警告 | 兼顾开发速度和分发安全 |
| 是否保留依赖原始 LICENSE 文件 | 保留 | 降低合规风险，体积影响通常可接受 |

### 11.2 工程风险

- Python 依赖的许可证获取比 npm 更复杂，可能需要 `pip-licenses` 或扫描 `.dist-info/METADATA`。注意 `lightrag-hku==1.5.4` 是 pinned 版本，扫描时应读取实际安装的 metadata 而非 requirements.txt 声明。
- Next standalone 打包可能只包含实际 traced deps，生成 notices 时应基于最终 `dist/app/node_modules` 再扫描一次（而不是开发环境的完整 `node_modules`）。
- 某些包的 `license` 字段可能是 `SEE LICENSE IN ...`，需要读取对应文件。
- 非代码资产容易遗漏，必须用手工 manifest 管理（如 GTE-multilingual 模型、icon.ico、字体）。
- **`stripDocs` 作用范围有限**：仅对 `next/react/react-dom/effect` 生效，其余依赖的 LICENSE 是否被裁剪取决于 Next standalone tracing 是否纳入它们。合规不能依赖保留原始 LICENSE，必须靠聚合 `THIRD-PARTY-NOTICES.txt`。
- **`app-metadata.ts` 的 git 策略**：`buildTime` 每次构建变化，git 跟踪会导致工作区永远 dirty，必须按 7.1.1 选择策略。
- **electron-builder `files` 与 `extraResources` 区别**：notices 走 `extraResources`（`dist/app → resources/app`），不受 `files` allowlist 控制；但需确认未来若调整 `extraResources` filter 不会误排除 `public/legal/` 或根 `LICENSE`。

## 12. 发布前合规检查清单

- [ ] About 版本与 `package.json` 一致。
- [ ] About 中版权文案不再使用 `All rights reserved / 保留所有权利`。
- [ ] 根目录 `LICENSE` 存在且为 Apache-2.0。
- [ ] `THIRD-PARTY-NOTICES.txt` 已生成。
- [ ] notices 覆盖 npm、Python、Electron、asset、runtime。
- [ ] 没有 `Unknown` 许可证条目。
- [ ] 没有未审查的 GPL/LGPL/AGPL/MPL 条目。
- [ ] Apache-2.0 依赖的 NOTICE 已保留或汇总。
- [ ] `dist/app/` 中存在 `LICENSE` 和 `THIRD-PARTY-NOTICES.txt`。
- [ ] **安装包解包后，`resources/app/` 下存在 `LICENSE` 和 `THIRD-PARTY-NOTICES.txt`**（用 7-Zip 打开 `.exe` 或检查 `%LOCALAPPDATA%\Programs\Synthetix\resources\app\`）。
- [ ] 打包裁剪没有删除 `next/react/react-dom/effect` 之外的许可证材料（注：其余包不受 `stripDocs` 影响）。
- [ ] README 和 release workflow 说明已同步。

## 13. 建议文件变更清单

预计新增：

```text
src/generated/app-metadata.ts
src/app/legal/third-party-notices/page.tsx
src/components/layout/third-party-notices-view.tsx
scripts/generate-app-metadata.mjs
scripts/generate-third-party-notices.mjs
legal/assets-notices.json
public/legal/third-party-notices.json
public/legal/THIRD-PARTY-NOTICES.txt
```

预计修改：

```text
src/components/layout/about-dialog.tsx
src/lib/i18n/types.ts
src/lib/i18n/locales/en.ts
src/lib/i18n/locales/zh-CN.ts
scripts/build-installer.mjs          # assemble 阶段调用 generate:notices，写入 dist/app/
electron-builder.yml                 # 核对 extraResources 是否覆盖 notices（预期无需改动，需验证）
.gitignore                           # 若采用策略 A，需忽略 src/generated/build-info.ts
package.json                         # 新增 generate:notices script
README.md
docs/release-workflow.md
e2e/navigation.spec.ts
```

> 注意：`scripts/build-electron.mjs` 原则上无需修改（它 verbatim 复制 `dist/app`），但需在实施时确认它不依赖会因新增文件而变化的路径断言。当前 `build-electron.mjs:77-93` 的断言只检查 `server.js`、`python.exe`、`daemon.py`、`migrations` 等既定文件，新增 notices 不影响这些断言。

## 14. 最小可交付版本

如果要先快速落地，建议切一个 MVP：

1. 修复 About 版本来源。
2. About 增加 Apache-2.0、核心组件和 Third-party Notices 入口。
3. 手工生成第一版 `THIRD-PARTY-NOTICES.txt`。
4. 打包脚本保留 `LICENSE`、`NOTICE`、`PATENTS`。
5. 安装包包含根目录 `LICENSE` 和 `THIRD-PARTY-NOTICES.txt`。

MVP 完成后再补自动扫描脚本和独立 notices 页面。

