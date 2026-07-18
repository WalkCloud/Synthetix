# Synthetix 在线升级能力分析与设计方案

> 文档状态：**分析与设计草案，尚未进入代码实施**  
> 分析日期：2026-07-18  
> 审查基线：分支 `fix/rag-cross-document-integrity`，提交 `9a6f722`  
> 当前应用版本：`package.json` 声明为 `1.0.3`  
> 目标平台：优先支持 Windows Electron 桌面版  
> 本轮边界：只分析现状并设计升级入口、交互和后续实施路线，**不修改升级代码、不重新打包、不发布新版本**。

---

## 1. 结论摘要

### 1.1 当前是否具备在线升级能力

结论需要区分“源码设计”和“现有发布链路”两层：

1. **源码层面：已经具备大部分升级基础能力。**
   - Electron 打包模式启动后会定时检查新版本。
   - Renderer 与 Electron 主进程之间已有更新 IPC Bridge。
   - “关于 Synthetix”弹窗中已有版本检查、下载进度和安装状态界面。
   - 主进程已有更新包下载、SHA-256 校验、Manifest Ed25519 验签、完整安装和 Patch 更新框架。

2. **当前用户可用层面：不能认定为已经具备可靠的在线升级能力。**
   - 当前线上/本地 `stable.json` 仍是旧格式，与现有更新器要求的新 Manifest Schema 不兼容。
   - 当前版本元数据存在 `1.0.3` 与 `1.0.1` 不一致的问题。
   - 构建脚本可能复用旧的 `win-unpacked`，导致安装器文件名、版本号与内部应用代码不一致。
   - 当前完整更新使用静默安装参数，不会弹出用户所期望的可见安装页面。
   - 检测到新版本后没有全局可见提醒，用户只有主动打开“关于”弹窗才能看到更新。

因此，当前状态应定义为：

> **在线升级框架部分具备，但发布链路和用户提醒链路尚未闭环，现有版本不能保证可靠完成“检测新版本 → 页面提醒 → 后台下载 → 显示安装页面 → 完成升级”。**

### 1.2 升级提醒按钮的推荐位置

主推荐位置：

> **已登录工作区左侧边栏底部，放在用户头像/账户菜单正上方。**

点击后打开现有“关于 Synthetix”弹窗，并在弹窗中展示：

- 当前版本与目标版本；
- 更新包大小；
- 更新说明；
- “立即下载”或“下载并安装”按钮；
- 下载进度；
- 下载完成后的“安装更新”按钮。

同时建议新版本首次被发现时显示一次轻量 Toast；Toast 只做即时提醒，侧边栏按钮作为持续入口。

---

## 2. 需求目标与设计边界

## 2.1 目标用户流程

期望形成以下完整流程：

```text
应用启动
  ↓
后台检查版本
  ↓
发现新版本
  ↓
侧边栏出现“发现新版本”按钮，并可选显示一次 Toast
  ↓
用户点击按钮查看版本说明
  ↓
用户确认下载
  ↓
Electron 主进程后台下载并实时反馈进度
  ↓
下载完成并通过签名、哈希校验
  ↓
界面显示“安装更新”
  ↓
用户确认后退出当前应用并打开安装页面
  ↓
安装完成后重新启动 Synthetix
  ↓
确认版本更新成功，清理暂存文件
```

## 2.2 本轮明确不做的内容

本文档不执行以下操作：

- 不修改 Electron 更新器代码。
- 不修改侧边栏或 About Dialog UI。
- 不修改 GitHub Release 资产。
- 不重新生成或上传 `stable.json`。
- 不生成新的 Ed25519 密钥。
- 不重新构建 Windows 安装包。
- 不设计 macOS/Linux 的第一阶段实现细节。
- 不把普通浏览器中的网页更新与 Windows 客户端更新混为一体。

---

## 3. 当前应用架构与能力边界

## 3.1 当前桌面应用架构

项目不是单纯的浏览器 Web 应用，而是由 Electron 承载本地 Next.js 服务：

```text
Electron 主进程
  ├─ 启动本地 Next.js standalone server
  ├─ 创建 BrowserWindow
  ├─ 提供 preload IPC Bridge
  ├─ 检查、下载并应用更新
  └─ 控制应用退出与重启

BrowserWindow
  └─ 加载 http://127.0.0.1:<port>
       └─ Next.js 页面与业务 API
```

相关证据：

- Electron 构建、发布和元数据脚本：`package.json:42-49`
- Electron 主入口：`package.json:52`
- Next.js 本地服务启动：`electron/main.ts:303-357`
- BrowserWindow 加载本地服务：`electron/main.ts:379-414`
- Windows NSIS 安装器配置：`electron-builder.yml:99-116`

## 3.2 普通浏览器与 Electron 的能力边界

普通浏览器页面不能安全地直接执行以下操作：

- 下载后运行 Windows EXE；
- 覆盖应用安装目录；
- 停止本地 Next.js 服务；
- 退出和重启 Electron；
- 执行安装程序。

当前代码也明确只在 Electron Bridge 存在时启用更新 UI：

- Electron 能力检测：`src/lib/update-bridge.ts:28-34`
- 浏览器环境降级处理：`src/lib/update-bridge.ts:36-70`
- About Dialog 条件渲染更新面板：`src/components/layout/about-dialog.tsx:22-57`

因此，本方案的“在线升级”特指：

> **Windows Electron 桌面客户端的应用内升级。**

普通 Web 部署应通过服务器重新部署完成升级，不应显示 Windows 客户端安装按钮。

---

## 4. 当前升级能力盘点

## 4.1 能力总表

| 能力环节 | 当前状态 | 判断 |
|---|---|---|
| Electron 桌面运行环境 | 已存在 | 已具备 |
| Windows NSIS 安装包 | 已存在 | 已具备 |
| 启动后自动检查更新 | 30 秒后首次检查，此后每 12 小时检查 | 已具备 |
| 手动检查更新 | About Dialog 可触发 | 已具备 |
| 新版本全局提醒 | 只在 About Dialog 中可见 | 缺失 |
| 主进程下载 | 支持 HTTPS 流式下载和进度 | 已具备 |
| 后台自动预下载 | 检测到版本后不会自动下载 | 缺失 |
| 下载取消与断点续传 UI | 未形成完整交互 | 缺失 |
| SHA-256 校验 | 已实现 | 已具备 |
| Ed25519 Manifest 验签 | 已实现 | 已具备，但线上发布未闭环 |
| 完整更新 | 可启动 NSIS 安装程序 | 部分具备 |
| 可见安装页面 | 当前使用 `/S` 静默安装 | 缺失 |
| Patch 快速更新 | 客户端框架已存在 | 部分具备 |
| 安装后自动重启 | 默认目录下有重启辅助逻辑 | 部分具备 |
| 自定义安装目录重启 | 重启路径硬编码默认目录 | 存在缺陷 |
| 强制更新 | 协议有 `forced`，UI 未执行强制策略 | 部分具备 |
| 发布 Manifest 生成 | 新发布脚本可生成并签名 | 已具备 |
| 当前线上 Manifest 兼容性 | 现有 `stable.json` 为旧格式 | 不可用 |
| 安装包代码签名 | 当前没有 Authenticode 配置 | 缺失 |
| 升级端到端测试 | 未发现旧版本到新版本的安装测试 | 缺失 |

## 4.2 自动检查更新

Electron 打包模式启动后：

- 30 秒后执行首次检查；
- 此后每 12 小时检查一次；
- 开发模式不自动请求正式发布通道；
- 状态变化通过 IPC 推送到 Renderer。

证据：

- 检查时间配置：`electron/main.ts:258-275`
- 状态推送：`electron/main.ts:277-285`
- 获取状态、手动检查和下载安装 IPC：`electron/main.ts:287-301`

这部分架构方向正确：版本检查和安装权限都留在 Electron 主进程，没有放入普通 Next.js API Route。

## 4.3 当前更新入口

当前更新入口位于：

```text
侧边栏底部用户头像
  → 打开账户菜单
  → 点击“关于”
  → 打开 About Dialog
  → 查看 UpdatePanel
```

相关代码：

- 侧边栏账户区：`src/components/layout/sidebar.tsx:221-238`
- About Dialog：`src/components/layout/about-dialog.tsx:22-57`
- Update Panel：`src/components/layout/update-panel.tsx:32-190`

Update Panel 已支持以下状态：

- `idle`
- `checking`
- `up-to-date`
- `available`
- `downloading`
- `ready`
- `installing`
- `error`

状态类型定义：`src/types/electron.d.ts:15-38`。

主要问题不是没有更新界面，而是：

> **该界面藏在 About Dialog 内，后台检查发现更新后没有全局常驻组件展示结果。**

## 4.4 下载与完整性校验

当前更新器已有以下能力：

- HTTPS 下载；
- 重定向限制；
- 下载进度；
- 下载时计算 SHA-256；
- 校验失败时拒绝安装；
- 将更新包暂存在应用 `userData` 下；
- 对 Manifest 进行 Ed25519 验签；
- 将验签后的资产 URL、大小和哈希固定下来，避免下载前被替换。

从安全架构看，下载和安装不应由页面传入任意 URL，而应只使用主进程验签后保存的资产信息。当前设计已经朝这一方向实现。

## 4.5 当前安装行为与需求不一致

Windows 安装器本身配置为普通向导：

- `oneClick: false`
- 允许用户选择安装目录

证据：`electron-builder.yml:109-116`。

但是在线完整更新启动安装程序时使用：

```text
/S /currentuser
```

证据：`electron/win-full-applier.ts:62-73`。

`/S` 表示静默安装，因此实际体验是：

```text
用户点击更新
  → 后台下载
  → 当前应用退出
  → 安装程序静默运行
  → 尝试重新启动应用
```

它不会显示用户所要求的安装页面。

因此当前只能认为具备“启动安装程序”的底层能力，不具备“下载完成后显示安装向导”的目标体验。

---

## 5. 当前阻断在线升级的关键问题

## 5.1 P0：当前 `stable.json` 与更新器 Schema 不兼容

当前更新器要求的核心结构为：

```json
{
  "version": "1.0.4",
  "channel": "stable",
  "platforms": {
    "win-x64": {
      "updateKind": "full",
      "full": {
        "url": "https://.../Synthetix.Setup.1.0.4.exe",
        "size": 123456789,
        "sha256": "..."
      }
    }
  },
  "signature": "..."
}
```

类型证据：`electron/updater.ts:90-125`。

当前仓库中的 `dist/electron/stable.json` 是旧结构：

```json
{
  "version": "1.0.3",
  "path": "full",
  "url": "https://.../Synthetix.Setup.1.0.3.exe",
  "size": 625053950,
  "sha256": "..."
}
```

证据：`dist/electron/stable.json:1-10`。

旧结构缺少：

- `channel`
- `platforms`
- `platforms.win-x64.full`
- `signature`

现有客户端会拒绝不符合 Schema 或无法通过签名验证的 Manifest。因此，即使更新检查请求成功，当前发布资产也无法可靠进入下载阶段。

## 5.2 P0：应用版本元数据不一致

当前存在：

- `package.json:3`：`1.0.3`
- `src/generated/app-version.ts:5`：`1.0.1`

About Dialog 显示的是生成元数据：

- `src/components/layout/about-dialog.tsx:49-53`

Electron 更新器版本判断通常依赖打包应用版本，而页面又显示另一份版本。版本来源不统一会导致：

- About Dialog 显示错误；
- 用户无法确认自己当前版本；
- 更新器比较结果与 UI 文案不一致；
- 发布支持和问题诊断失真。

发布前必须保证以下版本完全一致：

```text
package.json version
= app.getVersion()
= src/generated/app-version.ts
= 安装器版本
= Git tag
= GitHub Release 版本
= stable.json version
```

## 5.3 P0：构建脚本可能复用过期应用目录

`scripts/build-electron.mjs` 检测到以下文件存在时：

```text
dist/electron/win-unpacked/Synthetix.exe
```

会直接使用 `--prepackaged` 重新生成安装器，而不重新打包内部应用：

- `scripts/build-electron.mjs:111-143`

该快速路径没有验证：

- `win-unpacked` 内部版本是否等于 `package.json`；
- Electron main/preload 是否为最新；
- Next.js 资源是否为最新；
- 生成元数据是否为最新；
- Manifest 公钥是否为最新。

可能出现：

> 安装器文件名显示 `1.0.3`，内部应用实际仍是旧版本。

这会直接破坏升级判断和发布可信度。

## 5.4 P1：发现新版本后没有主动提醒

Electron 主进程会在后台保存 `available` 状态并向页面推送，但只有 About Dialog 中的 Update Panel 消费该状态。

`useUpdateStatus(false)` 已经支持被动订阅，并在注释中说明可用于全局 Badge：

- `src/lib/update-bridge.ts:73-115`

但当前侧边栏没有挂载该组件。因此：

- 后台可能已经发现更新；
- 用户页面没有任何变化；
- 用户必须主动打开 About Dialog 才能知道。

## 5.5 P1：下载和安装动作耦合

当前 IPC 名称和行为是：

```text
synthetix:update:download-and-install
```

证据：`electron/main.ts:298-301`。

Update Panel 中“立即更新”会直接进入下载并应用流程：

- `src/components/layout/update-panel.tsx:112-120`

为了满足“后台下载完成后，再跳出安装页面”的产品需求，建议未来将用户流程明确拆成：

```text
检查更新
→ 下载更新
→ 下载完成/校验完成
→ 用户确认安装
→ 启动安装页面
```

这样可以避免：

- 大文件下载完成后突然退出正在工作的应用；
- 用户误以为点击按钮只会查看更新，实际直接安装；
- 下载失败与安装失败混在同一动作中；
- 无法设计“稍后安装”。

## 5.6 P1：自定义安装目录可能无法自动重启

安装器允许用户更改安装目录：`electron-builder.yml:109-115`。

但更新后的重启路径被固定为：

```text
%LOCALAPPDATA%\Programs\Synthetix\Synthetix.exe
```

证据：`electron/win-full-applier.ts:75-84`。

如果用户第一次安装时选择了其他目录，安装完成后可能无法自动重新启动。

## 5.7 P1：Windows 安装包尚未进行 Authenticode 签名

当前配置明确注明测试构建没有代码签名：

- `electron-builder.yml:12-15`
- `electron-builder.yml:99-107`

Manifest Ed25519 签名能够证明“更新清单和下载资产没有被替换”，但不能替代 Windows Authenticode：

- 用户首次安装时仍可能看到 SmartScreen 警告；
- Windows 无法显示可信发布者；
- 安装体验和用户信任度受到影响。

如果面向公开用户发布，代码签名应作为正式启用在线升级前的发布门槛。

---

## 6. 升级按钮位置设计

## 6.1 主推荐位置

位置：

> **左侧边栏底部，用户头像/账户菜单正上方。**

当前侧边栏结构为：

```text
┌──────────────────────────┐
│ Synthetix 品牌区          │
├──────────────────────────┤
│ 工作区导航                │
│ 创作导航                  │
│ 设置导航                  │
│                          │
│          可滚动区域        │
├──────────────────────────┤
│ [发现新版本 v1.0.4]       │  ← 推荐新增位置
│ [头像 用户名 / 账户菜单]   │
└──────────────────────────┘
```

代码结构中的准确插入区域：

- 导航结束：`src/components/layout/sidebar.tsx:219`
- 账户底部区开始：`src/components/layout/sidebar.tsx:221`
- 用户菜单触发器：`src/components/layout/sidebar.tsx:222-234`

## 6.2 为什么这里最合适

### 全局可见

Dashboard 统一挂载固定侧边栏，用户无论在文档库、知识图谱、写作页还是设置页，都可以看到更新状态。

### 不干扰核心创作

更新是应用级系统状态，不是创作功能。放在底部不会占用主要导航区，也不会打断写作页面的核心操作。

### 与“关于”入口相邻

现有 About Dialog 从用户账户菜单打开。更新按钮放在头像上方符合用户认知：

```text
应用版本、关于、设置、账户
```

属于同一类系统级信息。

### 不与 Electron 标题栏冲突

侧边栏顶部品牌区同时是窗口拖拽区域：

- `src/components/layout/sidebar.tsx:167-180`

Electron 右上角还有系统最小化、最大化和关闭按钮：

- `electron/main.ts:389-399`

因此不建议把更新按钮放在顶部品牌区或窗口右上角。

### 不增加新的导航页面

升级提醒不是长期业务模块，不应增加第 11 个导航链接。点击它打开现有 About Dialog 即可，不需要改变页面路由或丢失当前工作上下文。

## 6.3 推荐视觉形态

### 普通可用更新

```text
┌────────────────────────┐
│ ↓ 发现新版本   v1.0.4  │
└────────────────────────┘
```

建议样式：

- 侧边栏内宽度占满；
- 高度约 36–40px；
- 琥珀色弱背景和边框；
- 左侧下载图标；
- 中间单行文案；
- 版本号靠右或作为小型 Badge；
- 鼠标悬停提升对比度；
- 键盘焦点使用现有共享 Button 样式。

### 下载中

```text
┌────────────────────────┐
│ ↓ 正在下载更新     42% │
│ █████████░░░░░░░░░░░░  │
└────────────────────────┘
```

### 下载完成

```text
┌────────────────────────┐
│ ✓ 更新已就绪            │
│    安装 v1.0.4          │
└────────────────────────┘
```

此时建议使用主色强调，因为操作已经从“告知”变成“待执行”。

### 强制更新

```text
┌────────────────────────┐
│ ! 必须更新至 v1.0.4     │
└────────────────────────┘
```

使用橙色或强琥珀色，不建议用红色。红色应保留给安装失败、文件校验失败等错误状态。

## 6.4 颜色语义

建议沿用项目现有状态色：

| 状态 | 颜色 | 含义 |
|---|---|---|
| 新版本可用 | 琥珀色 | 需要注意，但不是错误 |
| 下载中 | 主色/紫色 | 正在执行用户动作 |
| 下载完成 | 主色或绿色 | 已就绪，可安装 |
| 安装失败 | 红色 | 需要用户处理 |
| 已是最新版本 | 绿色，仅在详情中短暂显示 | 成功状态 |

新版本可用不是系统故障，不应使用持续闪烁的红点制造焦虑。

---

## 7. 不推荐的位置

## 7.1 不推荐仅放在 About Dialog

这是当前方案，发现性太弱。用户一般不会频繁进入“关于”。

About Dialog 应继续负责更新详情，但不应承担唯一提醒入口。

## 7.2 不推荐放在侧边栏顶部品牌区

原因：

- 品牌区是 Electron 窗口拖拽区域；
- 需要额外处理 `app-no-drag`；
- 容易与系统窗口按钮或品牌识别冲突；
- 更新状态不是品牌信息。

## 7.3 不推荐只放在页面 Header 右侧

当前普通页面和写作详情页没有完全统一的 Header。只修改一个 Header 会造成部分页面有更新按钮、部分页面没有。

另外，桌面窗口右上角还需避让系统窗口控制按钮。

## 7.4 不推荐只放在设置页

设置页适合未来增加：

- 自动检查开关；
- 更新通道；
- 当前版本；
- 最近检查时间；
- 手动检查按钮。

但设置页不适合作为发现新版本后的主要提醒入口，因为用户需要主动进入设置页面。

## 7.5 不推荐只用 Toast

Toast 适合作为首次发现时的一次性通知，但不能作为唯一入口：

- 会自动消失；
- 用户可能没有看到；
- 下载进度和待安装状态需要持续显示；
- 应用没有独立通知中心可供回看。

推荐组合是：

> **首次 Toast + 持久侧边栏按钮 + About Dialog 详情。**

---

## 8. 推荐交互流程

## 8.1 普通更新流程

### 阶段 A：发现更新

1. 应用启动 30 秒后进行后台检查。
2. 主进程验证 Manifest 签名并完成版本比较。
3. 如果没有更新，不显示任何全局 UI。
4. 如果发现更新：
   - 侧边栏底部显示“发现新版本”；
   - 本次版本首次发现时显示一次 Toast；
   - 不自动打开弹窗，不打断用户工作。

Toast 示例：

```text
Synthetix v1.0.4 已可用
[查看更新]
```

### 阶段 B：查看详情

用户点击侧边栏按钮后打开 About Dialog：

```text
Synthetix
当前版本 v1.0.3

发现新版本 v1.0.4
完整更新 · 596 MB

更新内容
- 修复……
- 优化……

[稍后] [立即下载]
```

设计要求：

- 用户留在当前业务页面；
- 弹窗关闭后不丢失编辑状态；
- 普通更新允许“稍后”；
- “稍后”只暂时关闭弹窗，侧边栏提醒仍保留；
- 可按目标版本保存本次会话或 24 小时的提醒静默，但不能永久忽略所有后续版本。

### 阶段 C：后台下载

用户点击“立即下载”后：

- Electron 主进程开始下载；
- 用户可关闭 About Dialog 并继续工作；
- 侧边栏持续显示下载进度；
- 再次点击侧边栏可查看详细进度；
- 下载失败时不强制弹窗，只在按钮或详情中提供重试；
- 如果未来支持取消，应提供明确取消按钮并删除未完成文件。

### 阶段 D：准备安装

下载完成后必须完成：

1. Manifest 签名有效；
2. 文件大小符合 Manifest；
3. SHA-256 一致；
4. 安装器存在且可读取；
5. 本地暂存路径未被替换；
6. 当前没有不可安全中断的关键任务。

然后状态改为“更新已就绪”：

```text
更新 v1.0.4 已下载完成
安装时 Synthetix 将退出，请先保存当前工作。

[稍后安装] [安装更新]
```

不建议下载完成后立即自动退出应用。用户可能正在写作或执行耗时任务，应让用户明确确认安装时间。

### 阶段 E：显示安装页面

用户点击“安装更新”后：

1. 检查未保存内容和运行中任务；
2. 停止本地 Next.js 服务；
3. 关闭或退出 Electron；
4. 使用可见模式启动 NSIS 安装器；
5. 安装器复用原安装目录；
6. 安装完成后启动新版本；
7. 新版本检查并清理旧暂存文件。

如果产品希望严格满足“跳出安装页面”，完整更新时不应使用 `/S` 静默参数。

## 8.2 Patch 快速更新流程

Patch 更新不一定需要显示 Windows 安装页面。建议使用不同文案：

```text
快速更新 v1.0.4
无需重新安装，应用将在更新后重新加载。

[稍后] [立即应用]
```

完整更新与 Patch 更新不能共用完全相同的 CTA：

| 更新类型 | 推荐按钮文案 | 预期行为 |
|---|---|---|
| Full | `下载更新` / `安装更新` | 退出应用并打开安装器 |
| Patch | `下载更新` / `立即应用` | 替换应用内容并重新加载/重启 |

## 8.3 强制更新流程

协议中已经有 `forced` 字段：

- `src/types/electron.d.ts:20-27`

但当前 UI 未使用它。建议只在以下情形使用强制更新：

- 旧版本存在高危安全漏洞；
- 服务器/API 已不兼容旧客户端；
- 数据格式变化会造成继续使用旧版本产生数据损坏。

强制更新应：

- 显示“必须更新”而非普通“发现新版本”；
- 说明强制原因；
- 不提供永久跳过；
- 允许用户先保存工作；
- 不能简单复用可随意关闭的普通 About Dialog；
- 如果更新检查暂时失败，不应误阻断用户。

---

## 9. 更新状态设计

建议形成以下状态机：

```text
unsupported
  └─ 普通浏览器，不显示更新 UI

idle
  └─ check → checking

checking
  ├─ no update → up-to-date → idle
  ├─ update found → available
  └─ failed → error

available
  ├─ dismiss → available（侧边栏弱提醒保留）
  └─ download → downloading

downloading
  ├─ completed + verified → ready
  ├─ cancel → available
  └─ failed → error

ready
  ├─ install full → launching-installer → app exits
  ├─ apply patch → installing → restarting/reloading
  └─ later → ready（侧边栏持续提醒）

error
  ├─ retry → checking / downloading
  └─ dismiss → idle 或 available
```

## 9.1 状态显示矩阵

| 状态 | 侧边栏 | About Dialog | 是否主动打扰 |
|---|---|---|---|
| Web 不支持 | 隐藏 | 隐藏更新区 | 否 |
| `idle` | 隐藏 | 显示“检查更新” | 否 |
| `checking` | 默认隐藏 | 显示检查中 | 否 |
| `up-to-date` | 隐藏 | 短暂显示已是最新 | 否 |
| `available` | 显示琥珀色按钮 | 显示详情和下载动作 | 首次可 Toast |
| `downloading` | 显示进度 | 显示详细进度 | 否 |
| `ready` | 显示强 CTA | 显示安装确认 | 可通知一次 |
| `installing` | 禁用并显示 Spinner | 显示安装中 | 否 |
| 自动检查失败 | 默认不显示红色按钮 | 用户打开详情时可见 | 否 |
| 用户主动操作失败 | 显示可恢复提示 | 显示错误和重试 | 是，但不过度 |
| 强制更新 | 显示“必须更新” | 显示不可永久跳过流程 | 是 |

---

## 10. 安全与发布设计要求

## 10.1 Manifest 信任模型

更新客户端只应信任同时满足以下条件的资产：

1. Manifest 来源使用 HTTPS；
2. Manifest 通过内置公钥完成 Ed25519 验签；
3. Manifest 包含当前平台 `win-x64` 的资产；
4. 远端版本高于当前版本；
5. 下载 URL、大小、SHA-256 与已验签内容一致；
6. 下载完成后重新校验文件；
7. 安装前不允许 Renderer 替换资产 URL 或本地路径。

Renderer 只应接触公开状态，不应获得或控制：

- 任意下载 URL；
- Manifest 签名密钥；
- 可执行文件路径选择权；
- 安装参数；
- 任意命令执行能力。

## 10.2 Windows Authenticode

正式面向用户发布前，建议为以下产物签名：

- `Synthetix.exe`
- Windows NSIS 安装器
- 如有独立更新辅助程序，也应签名

验收时应确认：

- Windows 文件属性显示正确发布者；
- 安装器签名有效且证书未过期；
- 时间戳服务器可用；
- 更新下载后的文件签名可额外验证；
- SmartScreen 体验符合公开发布要求。

## 10.3 防止降级与重复提示

建议：

- 默认禁止安装低于或等于当前版本的 Manifest；
- 只有明确的受控回滚机制才允许降级；
- 按目标版本记录“已提示”“稍后提醒”和“下载完成”；
- 新版本发布后不能被旧版本的静默设置永久屏蔽；
- Stable 与 Beta 通道的数据和提示状态分开保存。

## 10.4 暂存文件清理

应在以下时机清理：

- SHA 校验失败；
- 用户取消下载；
- Manifest 已更新且旧暂存包失效；
- 安装成功后的首次启动；
- 暂存文件超过保留期限；
- 磁盘空间不足时。

不能无限保留数百 MB 的历史安装器。

---

## 11. 推荐的目标架构

```text
GitHub Release / 受控更新服务器
  ├─ Synthetix Setup <version>.exe
  ├─ 可选 content-<version>-win.zip
  └─ stable.json（Ed25519 签名）
           ↓ HTTPS
Electron Update Engine
  ├─ 周期检查
  ├─ Manifest Schema 校验
  ├─ Ed25519 验签
  ├─ SemVer 比较
  ├─ 平台与 Full/Patch 选择
  ├─ 下载、进度和取消
  ├─ SHA-256 校验
  ├─ 暂存和清理
  └─ Full/Patch Applier
           ↓ 仅公开状态
Preload IPC Bridge
           ↓
全局 Update Status Provider
  ├─ 侧边栏升级按钮
  ├─ 首次发现 Toast
  └─ About Dialog / Update Panel
```

设计原则：

- Electron 主进程是更新状态的唯一真实来源；
- 页面组件不重复发起并行检查；
- 侧边栏使用被动订阅；
- About Dialog 可提供手动刷新；
- 下载和安装拆成明确阶段；
- Full 与 Patch 使用不同说明；
- 更新 UI 在浏览器模式完全隐藏。

---

## 12. 后续实施建议

虽然本轮不修改代码，但建议后续按以下顺序实施，避免先做按钮、后发现底层发布不可用。

## 阶段 0：修复发布完整性

优先级：P0。

目标：确保每个发布产物内部代码、版本号和 Manifest 完全一致。

建议工作：

1. 统一版本来源；
2. 发布前自动执行 `generate:meta`；
3. 禁止无条件复用旧 `win-unpacked`；
4. 增加安装器内部版本检查；
5. 增加 Manifest Schema 校验；
6. 验证 `stable.json` 已签名；
7. 验证 GitHub Release 资产和本地 SHA 一致；
8. 对 Authenticode 签名建立正式配置。

阶段验收：

```text
package.json
= 生成版本文件
= app.getVersion()
= 安装器版本
= stable.json
= Git tag
= GitHub Release
```

## 阶段 1：打通 Full 在线升级

优先级：P0/P1。

目标：从旧版本客户端完整升级到新版本。

建议先只支持 Full 更新，不急于启用 Patch：

- 检查；
- 提醒；
- 用户确认下载；
- 后台下载；
- 校验；
- 用户确认安装；
- 显示安装页面；
- 安装后重启；
- 清理暂存文件。

Full 链路稳定后再开放 Patch，可显著降低首次上线风险。

## 阶段 2：增加全局提醒入口

优先级：P1。

建议工作：

- 增加全局更新状态 Provider；
- 在侧边栏底部增加升级按钮；
- 点击按钮打开 About Dialog；
- 首次发现显示 Toast；
- 增加“稍后”；
- 侧边栏显示下载进度和待安装状态；
- 增加可访问性播报。

## 阶段 3：拆分下载与安装

优先级：P1。

建议将当前“下载并安装”单一动作拆分为：

```text
checkNow
startDownload
cancelDownload
installStagedUpdate
getStatus
onProgress
```

这不是最终 API 命名要求，而是行为边界建议。

## 阶段 4：完善 Patch 更新

优先级：P2。

只有满足以下条件才启用 Patch：

- Patch 包内容和迁移文件完整；
- Runtime Hash 判断可靠；
- 失败回滚经过测试；
- 更新成功后状态正确收敛；
- 数据库备份和恢复经过真实数据验证；
- Full 更新始终可作为兜底。

## 阶段 5：建立 Windows 自动发布和升级测试

优先级：P1。

建议在 Windows CI/Release Workflow 中执行：

1. 生成版本元数据；
2. 构建 Next.js standalone；
3. 编译 Electron；
4. 全新打包 `win-unpacked`；
5. 构建并签名 NSIS 安装器；
6. 解包检查内部版本；
7. 生成并签名 Manifest；
8. 在测试 Release 中上传；
9. 使用上一个稳定版本执行升级 E2E；
10. 验证新版本启动和数据保留；
11. 验证成功后再发布 Stable Manifest。

---

## 13. 测试矩阵

## 13.1 版本检查

- 当前版本等于最新版本；
- 当前版本低于最新版本；
- 远端版本格式错误；
- Manifest 缺字段；
- Manifest 签名缺失；
- Manifest 签名错误；
- Stable/Beta 通道隔离；
- 网络超时、DNS 失败和 GitHub 限流；
- 服务器返回 404/500；
- 首次检查和周期检查不重复并发。

## 13.2 UI

- 普通浏览器隐藏更新入口；
- Electron `available` 状态显示侧边栏按钮；
- 点击按钮打开 About Dialog；
- 普通更新可“稍后”；
- 下载中显示正确进度；
- 下载完成显示安装动作；
- 自动检查失败不产生持续红色噪音；
- 手动更新失败可重试；
- Full 与 Patch 文案不同；
- 强制更新不允许永久跳过；
- 键盘、屏幕阅读器和焦点管理正常。

## 13.3 下载与校验

- 正常下载；
- 重定向；
- 下载中断；
- 用户取消；
- 磁盘空间不足；
- 文件大小不一致；
- SHA-256 不一致；
- 下载完成后文件被替换；
- 旧暂存包失效；
- 多次点击不会启动重复下载。

## 13.4 安装

- 默认安装目录；
- 用户自定义安装目录；
- 安装器显示正常；
- 用户取消安装；
- 安装失败；
- 应用退出前存在未保存内容；
- 本地 Next.js 服务正确停止；
- 安装完成后自动重启；
- 新版本首次启动清理暂存文件；
- 用户数据库和文档数据保留；
- 从至少两个历史稳定版本升级到最新版本。

## 13.5 发布完整性

- 安装器文件名版本正确；
- 安装器内部 `package.json` 版本正确；
- About Dialog 版本正确；
- Electron `app.getVersion()` 正确；
- Manifest 版本正确；
- Git tag 和 Release 名称正确；
- 安装器 SHA 与 Manifest 一致；
- Manifest 签名可由客户端公钥验证；
- 安装器 Authenticode 签名有效。

---

## 14. 验收标准

只有同时满足以下标准，才能对外宣称“程序具备在线升级能力”：

1. 已发布旧版本能够自动发现测试新版本；
2. 侧边栏能够持续显示新版本提醒；
3. 用户点击后能查看版本说明和文件大小；
4. 用户可选择稍后或开始下载；
5. 下载在 Electron 主进程中执行，页面只接收进度；
6. Manifest 签名和更新包哈希均通过校验；
7. 下载完成后不会在用户无确认时突然退出；
8. 用户确认安装后能够看到 Windows 安装页面；
9. 自定义安装目录也能正确升级和重启；
10. 升级后显示的新版本与实际安装版本一致；
11. 用户数据、数据库和文档没有丢失；
12. 下载失败、安装取消和安装失败均可恢复；
13. 更新暂存文件能够被清理；
14. 普通浏览器环境不显示不可用的桌面升级入口；
15. CI 或发布检查能阻止版本号、安装器和 Manifest 不一致的发布。

---

## 15. 最终设计决策

### 15.1 能力判断

当前程序不是“完全没有升级功能”，而是：

> **已经有较完整的 Electron 自定义更新器基础，但线上 Manifest、版本元数据、构建产物和用户提醒尚未形成可信闭环。**

在修复 P0 发布问题并完成真实旧版本升级测试前，不应向用户承诺现有安装包已经支持可靠在线升级。

### 15.2 按钮位置

最终推荐：

> **左侧边栏底部、用户头像正上方，显示持久升级按钮。**

按钮负责“发现和返回”，现有 About Dialog 负责“查看详情和执行更新”。首次发现时可增加一次 Toast，但 Toast 不是唯一入口。

### 15.3 推荐的第一版上线范围

第一版建议只上线：

- Windows Electron；
- Stable 通道；
- Full 完整更新；
- 手动确认下载；
- 下载完成后手动确认安装；
- 可见 NSIS 安装页面；
- 完整签名和哈希校验；
- 侧边栏提醒；
- 真实旧版本升级 E2E。

Patch、Beta 通道、强制更新、后台自动预下载和断点续传可以在 Full 更新链路稳定后分阶段加入。

---

## 16. 相关代码索引

| 领域 | 文件 |
|---|---|
| Electron 启动、检查调度和 IPC | `electron/main.ts` |
| 更新状态、Manifest、下载和校验 | `electron/updater.ts` |
| Manifest 签名 | `electron/manifest-signing.ts` |
| 更新策略与路径安全 | `electron/update-policy.ts` |
| Windows Full 更新 | `electron/win-full-applier.ts` |
| Windows Patch 更新 | `electron/win-patch-applier.ts` |
| Preload Bridge | `electron/preload.ts` |
| Renderer 更新 Bridge | `src/lib/update-bridge.ts` |
| Renderer 更新状态类型 | `src/types/electron.d.ts` |
| About Dialog | `src/components/layout/about-dialog.tsx` |
| 更新详情面板 | `src/components/layout/update-panel.tsx` |
| 推荐按钮所在侧边栏 | `src/components/layout/sidebar.tsx` |
| Electron 打包配置 | `electron-builder.yml` |
| Electron 构建脚本 | `scripts/build-electron.mjs` |
| Release 与 Manifest 发布脚本 | `scripts/publish-release.mjs` |
| 应用版本生成文件 | `src/generated/app-version.ts` |
| 当前旧格式 Manifest | `dist/electron/stable.json` |

---

## 17. 实施记录（2026-07-18）

本设计已于 2026-07-18 按批准的计划全阶段实施。下面如实记录每阶段的完成状态与验证边界。

### 17.1 已在本环境验证通过

| 验证项 | 命令 / 证据 |
|---|---|
| 版本元数据一致性 | `npm run verify:versions` ✓（修复了 `app-version.ts` 从 1.0.1 → 1.0.3 的漂移；并发现现有 `win-unpacked/app.asar` 内部仍是 1.0.1，已删除并新增 build-electron 复用前校验） |
| TypeScript 编译 | `npx tsc --noEmit --incremental false` ✓（root + electron 工程） |
| Lint | `npx eslint <new/modified files>` ✓ |
| 单元测试 | `npx vitest run` ✓ —— 1002/1002 通过，含 21 个新增（`getReminderState` ×10、`shouldShowUpdateToast` ×7、asar-version ×4） |
| 生产构建 | `npm run build` ✓（standalone 产物生成） |
| Playwright E2E | **未能在本环境运行** —— 共享的 `global-setup.ts` 登录在沙箱内失败（admin 账号未初始化）。该失败在改动前的基线代码上同样发生，与本次修改无关。NAV-07 测试代码已 typecheck 通过，使用 `addInitScript` 注入 `window.synthetix` mock 的标准模式。 |

### 17.2 各阶段实施清单

**阶段 0（版本元数据一致性，P0，已验证）**
- `src/generated/app-version.ts` 重新生成为 1.0.3。
- `package.json` 的 `build` / `electron:build` / `publish` 链入 `generate:meta`。
- 新增 `scripts/lib/asar-version.mjs` + `scripts/verify-version-consistency.mjs` + `npm run verify:versions`。
- `scripts/build-electron.mjs` 复用 `win-unpacked` 前校验 app.asar 内版本，过期则删除并触发完整重建。
- `e2e/navigation.spec.ts` NAV-05 版本断言改为动态读取 `app-version.ts`。
- `.github/workflows/ci.yml` 接入 `generate:meta` + `verify:versions`。

**阶段 2（全局升级提醒入口，已验证）**
- 新增 `src/lib/update-status-context.tsx`（`UpdateStatusProvider`，单点订阅 + 首次发现 Toast）。
- 新增 `src/lib/update-toast-logic.ts`（纯函数 `shouldShowUpdateToast`）+ 单测。
- 新增 `src/lib/update-reminder-state.ts`（纯函数 `getReminderState`）+ 单测。
- 新增 `src/components/layout/update-reminder-button.tsx`（侧边栏底部按钮，用 `<button>` 不破坏 `aside a` 计数）。
- `src/components/providers.tsx` 在 `LocaleProvider` 内挂载 `UpdateStatusProvider`。
- `src/components/layout/sidebar.tsx` 在 `UserMenuTrigger` 上方插入按钮。
- `src/components/layout/update-panel.tsx` 改用共享 Provider；新增 `available` 强制更新分支（`role=alert`、无“稍后”）；新增下载进度“取消”。
- i18n 新增 `sidebarAvailable/sidebarMustUpdate/sidebarDownloading/sidebarInstall/sidebarInstalling/mustUpdate/newVersionToast/viewUpdate/downloadNow/cancelDownload/applyNow`。

**阶段 1（Full 在线升级链路，代码完成，真实升级待验证）**
- `electron/updater.ts` 新增 `cleanupStaging()`；`applyStagedUpdate` 的 patch 分支成功后收敛状态（不再停在 `installing`）；`LatestManifest` 补 `signature?: string` 字段。
- `electron/main.ts` 新增 `synthetix:update:start-download` / `cancel-download` / `install-staged` IPC；boot 时调用 `cleanupStaging()`。
- `electron/preload.ts` 暴露 `startDownload/cancelDownload/installStaged`。
- `electron/win-full-applier.ts` 移除 `/S`（显示安装向导）；重启路径改用 `resolveInstalledExe()`（当前进程目录 → 注册表 → 默认目录）；启动安装器后清理暂存。
- 新增 `electron/lib/resolve-install-path.ts`（重启路径解析）。

**阶段 3（下载/安装分离，已验证）**
- `src/lib/update-bridge.ts` 新增 `startDownloadUpdate/cancelDownloadUpdate/installStagedUpdate`；`useUpdateStatus` 返回值扩展。
- `src/types/electron.d.ts` `UpdateBridge` 补三方法。
- `update-panel.tsx`：`available` → “立即下载”；`downloading` → “取消下载”；`ready` → full“重启并安装”/ patch“立即应用”。

**阶段 4（Patch 完善，代码完成，真实 patch 待验证）**
- `scripts/publish-release.mjs` content zip 现包含 `prisma/migrations`（仅 SQL，不含 engine 二进制）。
- `electron/win-patch-applier.ts` `PATCHABLE_DIRS` 增加 `prisma/migrations`。
- `electron/updater.ts` patch apply 成功后 `checkForUpdates()` 收敛状态。

**阶段 5（Windows 发布 CI，配置可写，运行待 Windows runner）**
- `electron-builder.yml` `win` 段改为环境变量驱动的签名配置占位（`signingHashAlgorithms: ["sha256"]`，证书通过 CI `--config.win.certificateFile` 注入）。
- 新增 `.github/workflows/release-windows.yml`（tag 触发 → build → verify:versions → 签名 → publish；YAML 语法已校验）。
- 留 `TODO(upgrade-e2e)`：旧版本→新版本升级 E2E 需版本矩阵，列为后续任务。

### 17.3 需后续真实环境验证（不在本环境声称已验证）

以下内容代码已写好、可测纯逻辑已有单测覆盖，但端到端行为必须依赖真实 Windows 环境 / 证书 / Release，本沙箱无法运行，因此不做“已验证”声明：

1. 真实 NSIS 可见安装页面（阶段 1.2）—— 需 Windows 构建。
2. 自定义安装目录升级后正确重启（阶段 1.2）—— 需 Windows + 多目录安装。
3. 暂存文件在真实升级后清理（阶段 1.3）—— 需真实升级。
4. 真实 Electron 下 Toast 首次触发时机（阶段 2.1）—— 需 Electron 打包运行。
5. 真实下载取消/重试（阶段 3）—— 需真实大文件下载。
6. 真实 Patch 升级 + DB 迁移 + 回滚（阶段 4）—— 需多版本 Windows 环境。
7. Authenticode 签名 + SmartScreen 体验（阶段 5.1）—— 需证书。
8. Windows release workflow 实际运行（阶段 5.2）—— 需 Windows runner + secrets。
9. 旧版本→新版本升级 E2E（阶段 5.3）—— 需版本矩阵。
10. Playwright E2E NAV-07（侧边栏按钮）—— 受限于本沙箱 global-setup 登录失败，代码与 typecheck 已就绪。
