# Synthetix 跨平台应用内自动升级方案设计

> **日期**: 2026-07-08（跨平台修订版）
> **状态**: 设计稿（待评审）
> **平台**: Windows (x64) + macOS (Apple Silicon arm64 + Intel x64)
> **上游**: `desktop-packaging-distribution-plan-2026-06-29.md` §阶段 6 / §阶段 7

---

## 0. 你的需求 vs 跨平台现实

你的原始设想是两级更新:
- 全局更新 → 下载完整包 → 覆盖安装
- 非全局更新 → 不重装 → 增量升级

**这个直觉是对的，但"增量"在两个平台上的可行性和实现方式完全不同**——这不是技术选型偏好，是**平台硬约束**:

| | Windows | macOS |
|---|---|---|
| 安装形态 | 散文件目录 + NSIS 安装器 | 单个 `.app` bundle（目录但有封印） |
| 签名机制 | Authenticode（可选，不签也能跑，只是 SmartScreen 警告） | **代码签名 + 公证（强制）**——不签/Gatekeeper 直接拦截无法运行 |
| 签名后能否改 bundle 内容 | **可以**（无封印概念，per-user 目录用户可写） | **绝对不行**——改任何字节都会破坏签名封印，应用无法启动 |
| **增量更新的可行性** | ✅ 原地替换 `.next/`（patch 路径） | ❌ 只能整包替换 |
| 增量"小下载"如何实现 | content zip（自研，替换 `.next/`） | Sparkle 的 delta 差分（仍整包替换，但只下载差异字节） |
| 用户权限 | per-user 安装，无 UAC | 拖到 `/Applications`，无 UAC |

**结论先行**: 两个平台必须采用**不同的更新策略**，用一份统一清单 `latest.json` 驱动，应用按平台自动选路:

```
Windows:  patch(原地替换 .next/) ──┐
          full(NSIS 静默覆盖)   ────┤
                                    ├── 同一份 latest.json
macOS:    full(整包替换 .app) ──────┤
          delta(Sparkle 差分) ──────┘  可选，优化项
```

> **坦诚评估**: macOS 上"增量"只能靠 Sparkle delta（仍整包替换，但下载量小）。维护 delta 文件会增加发布复杂度。**建议 macOS 首发 only 全量替换**，delta 作为后续优化。Windows 的 patch 路径是 Synthetix 独有的真实价值点（载荷分层结构决定的），值得做。

---

## 1. 现状盘点（已核实）

### 1.1 运行时架构（双平台共用）

```
Synthetix.exe / Synthetix.app (Electron 壳)
├─ 主进程 main.ts
│   ├─ 单实例锁 ✅
│   ├─ 首次运行 first-run.ts (密钥 + 建库) ✅
│   ├─ 选端口 → spawn Next standalone server.js (子进程) ✅
│   ├─ 健康检查 → BrowserWindow.loadURL ✅
│   ├─ 托盘、优雅退出 ✅
│   └─ ❌ 无任何更新检查逻辑
│
└─ 真实载荷 (~1.4GB)
    Windows: <install>/resources/app/
    macOS:   Synthetix.app/Contents/Resources/app/
    ├─ server.js, .next/, node_modules/      ← Web/JS 层（Win 可增量）
    ├─ runtime/python/, workers/python/      ← Python 运行时层（平台+架构相关）
    ├─ runtime/node.exe | node               ← Node 二进制（平台相关）
    ├─ prisma/migrations/                    ← 11 个迁移
    ├─ models/gte-multilingual-base/         ← ONNX 嵌入模型 (~340MB)
    └─ public/
```

### 1.2 双平台载荷差异表（关键）

| 组件 | Windows x64 | macOS arm64 | macOS x64 | 升级含义 |
|---|---|---|---|---|
| Node 二进制 | `runtime/node.exe` (win-x64) | `runtime/node` (darwin-arm64) | `runtime/node` (darwin-x64) | 平台相关，三套独立 |
| CPython | `runtime/python/python.exe` (win embeddable / python-build-standalone) | universal2 或 arm64 | universal2 或 x64 | 平台相关，三套独立 |
| 原生模块 `.node` | `better_sqlite3.node` win-x64 (Node ABI) | darwin-arm64 | darwin-x64 | **ABI 必须匹配 standalone Node，非 Electron ABI** |
| `.next/` (JS) | 跨平台共用 | 跨平台共用 | 跨平台共用 | **Win patch 可用同一 zip** |
| ONNX 权重 | 跨平台共用 | 跨平台共用 | 跨平台共用 | 不随包，按需下载 |
| Prisma 迁移 | 跨平台共用 | 跨平台共用 | 跨平台共用 | 迁移逻辑共用 |

> **关键**: `better-sqlite3`/`@node-rs/jieba`/`sharp` 的 prebuilt 必须是**标准 Node ABI**（因为 Next standalone server 跑在独立 Node 子进程，不在 Electron 的 Node 里）。这和 `electron-builder.yml` 的 `npmRebuild: false` 一致——不要为 Electron ABI 重新编译。macOS 双架构需各自有对应 prebuilt。

### 1.3 当前状态（要新建的清单）

- `electron-updater` 未安装；`electron-builder.yml` 无 `publish` 块。
- `electron/main.ts` 无 `autoUpdater`。
- `electron/preload.ts` 仅暴露 `version/platform/isPackaged/setTitleBarColor`。
- 无 `latest.json` 更新清单。
- 无 CI/CD。
- **无 macOS 构建配置**（当前 `electron-builder.yml` 仅 `--win nsis`）。
- 无任何代码签名。
- `first-run.ts` 对已存在 DB **跳过迁移**（升级风险点，§7 修复）。
- `VERSION` 文件 (`0.5.4.0`) 陈旧遗留，应清理。

### 1.4 版本元数据（已部分就绪）

`src/generated/app-version.ts`（`version: "1.0.1"`）+ `public/build-info.json`（`buildTime`/`commit`）。About 对话框已展示，是天然的更新入口。

---

## 2. 市场调研（双平台，主流应用怎么升级）

> ⚠️ 包大小为训练知识估算，落地前需核验。

### 2.1 Windows 桌面应用

| 应用 | 壳 | 升级方式 | 单次下载 |
|---|---|---|---|
| VS Code | Electron | electron-updater 全量替换 app.asar | ~100MB |
| Slack / Discord | Electron | 全量替换 | ~100–200MB |
| Chrome | 自研 | Courgette 二进制差分（专人团队） | 增量 ~10MB |
| AnythingLLM | Electron (Node+Prisma+Python) | **全量重装** | ~300–500MB |

### 2.2 macOS 桌面应用

| 应用 | 壳 | 升级方式 | 备注 |
|---|---|---|---|
| **大多数原生 Mac 应用** (OBS, HandBrake, Bitwarden) | 原生 | **Sparkle**（整包替换 + 可选 delta） | Mac 事实标准，开源，极其成熟 |
| VS Code / Slack / Notion (Mac 版) | Electron | electron-updater（整包替换 .app） | 不用 delta |
| **Craft / Things / Tower** 等精品 Mac 应用 | 原生 | Sparkle + delta | delta 是 Mac 上"增量"的唯一现实路径 |
| Chrome (Mac) | 原生 | 自研差分 | 专人团队 |
| **ComfyUI Desktop** (Mac) | Electron + 捆绑 Python | electron-updater 全量 | 与 Synthetix 最接近 |

**双平台共性结论**:
1. **重型 AI 应用（含 Python/原生运行时）全部全量重装**，无一做文件级增量。
2. **macOS 上的"增量"= Sparkle delta**：仍整包替换（绕开签名封印），但通过 bsdiff 只传输差异字节。这是 Mac 上"小下载"的唯一正确做法。
3. **Windows 上的"增量"= Synthetix 独有的 content zip**：因为载荷不在 app.asar（在 extraResources），且 per-user 目录可写，所以能原地替换 `.next/`。这是 Synthetix 的特殊优势，不是行业标配。

### 2.3 两条路径的技术对比

| | Sparkle delta (macOS) | Content zip (Windows patch) |
|---|---|---|
| 原理 | 对整个 .app 做 bsdiff，生成 .delta 文件，客户端差分重组 | 只打包变更的 `.next/` 子树，原地覆盖 |
| 下载量 | 差异字节（小版本可能 ~10–50MB） | `.next/` + 变更 JS 依赖（~30–150MB） |
| 客户端是否替换整个 app | 是（仍整包替换，绕开签名问题） | 否（只替换子树） |
| 签名影响 | 替换后重验签（Sparkle 支持） | Windows 无封印，无影响 |
| 发布复杂度 | 每版需对每个"源版本"生成 delta（组合爆炸） | 单个 content zip |
| 何时值得做 | macOS 用户多 + 高频小更新 | 始终值得（Win 主力） |

---

## 3. 推荐架构: 平台感知的双通道升级

### 3.1 总体设计

一份 `latest.json` 描述所有平台的所有资产；应用按 `process.platform` + `process.arch` 选取；按平台走不同更新路径:

```
┌──────────────────────────────────────────────────────────────────┐
│  应用启动 + 每 12h → fetch latest.json (按 channel)                │
│  semver 比较 → 有新版?                                             │
│  按 process.platform 选资产:                                       │
│                                                                   │
│  WINDOWS ────────────────────────    MACOS ──────────────────────┐
│  ┌─ minRequired 强制? → full ─┐     ┌─ 有 delta 匹配当前版? ──┐  │
│  │ 当前版 ∈ patch.availableFrom?  │    │   是 → delta 路径(下载小)│  │
│  │   是 → patch (content zip)     │    │   否 → 全量 dmg/zip     │  │
│  │   否 → full (NSIS 静默)        │    └─────────────────────────┘  │
│  └─ runtime-hash 不匹配 → 降 full ┘    下载 → 校验 → 替换 .app       │
│  下载 → 校验 → 关服 → 备份 → 应用      (Sparkle 或 electron-updater)│
│  → 迁移 → 重启                         → 迁移 → 重启               │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 平台更新路径详解

**Windows — patch 路径（推荐主力）**:
- 关闭 Next 子进程（释放 `better_sqlite3.node` 句柄，否则 EPERM）。
- 备份 `.next/` + `public/` 到 `<userData>/update-backup-<oldVer>/`；备份 `dev.db`。
- 解压 content zip 覆盖 `resources/app/`（per-user 目录可写，无 UAC）。
- 跑迁移（幂等）→ 重启 Next → 健康检查。失败自动回滚备份。

**Windows — full 路径**:
- 下载 NSIS 安装器，校验 sha256 + 签名（签名后）。
- 静默运行 `Synthetix-Setup.exe /S /currentuser`（NSIS 静默 + per-user 免 UAC）。
- 安装器覆盖安装目录；用户数据在 `%APPDATA%` 不受影响。

**macOS — 全量替换（唯一可行）**:
- 下载 `.app`（dmg 内的或 zip 解包的）。
- 校验签名（codesign verify）+ 公证票据（stapler）。
- 关闭 Next 子进程 → 退出当前应用 → 替换 `/Applications/Synthetix.app` → 重启。
- 可选用 Sparkle 自动编排上述流程（含 delta 差分重组）。
- 跑迁移 → 重启 Next。

**macOS — delta 路径（可选优化）**:
- Sparkle 从"当前版本 → 目标版本"的 `.delta` 文件下载差异字节。
- 客户端用 bsdiff 重组出完整新 `.app`，验签后替换。
- 下载量小，但发布端要为每个"源版本×目标版本"组合生成 delta（或用 Sparkle 的 `generate_appcasts` 自动处理）。

### 3.3 判定逻辑（应用端，跨平台统一入口）

```
fetch latest.json → 按 platform/arch 选 platformAssets[]
当前版本 < minRequiredVersion?         → 强制更新（阻断 UI）
Windows:
  当前版 ∈ patch.availableFrom 且 runtime-hash 匹配  → 可选 patch（推荐）
  否则                                                → full
macOS:
  有 delta(当前版 → 目标版)?  → delta（推荐）
  否则                        → 全量
```

---

## 4. 统一更新清单 `latest.json`

托管: GitHub Releases 固定资产名 + 多通道分文件（`stable.json` / `beta.json`）。

```jsonc
{
  "version": "1.1.0",
  "releaseName": "1.1.0 — Knowledge Graph v2",
  "channel": "stable",
  "publishedAt": "2026-07-15T10:00:00Z",
  "minRequiredVersion": "1.0.0",

  // 平台无关的元信息
  "releaseNotes": {
    "en": "### New\n- ...",
    "zh-CN": "### 新功能\n- ..."
  },
  "forceFull": false,

  // 每平台独立资产块
  "platforms": {

    "win-x64": {
      "updateKind": "patch",                // 发布者声明
      "full": {
        "url": "https://.../Synthetix-Setup-1.1.0.exe",
        "size": 629145600,
        "sha256": "...",
        "signature": "..."                  // Authenticode 签名（签名后）
      },
      "patch": {                            // updateKind=patch 时
        "availableFrom": ["1.0.1", "1.0.2"],
        "url": "https://.../content-1.1.0-win.zip",
        "size": 33554432,
        "sha256": "...",
        "includesMigrations": true,
        "minRuntimeHash": "..."             // 运行时层指纹护栏
      }
    },

    "darwin-arm64": {
      "full": {
        "url": "https://.../Synthetix-1.1.0-arm64-mac.zip",
        "size": 750000000,
        "sha256": "..."
      },
      "deltas": [                           // Sparkle delta（可选）
        { "from": "1.0.1", "url": "https://.../Synthetix1.0.1-1.1.0.delta", "size": 45000000, "sha256": "..." },
        { "from": "1.0.2", "url": "https://.../Synthetix1.0.2-1.1.0.delta", "size": 30000000, "sha256": "..." }
      ]
    },

    "darwin-x64": {
      "full": {
        "url": "https://.../Synthetix-1.1.0-x64-mac.zip",
        "size": 760000000,
        "sha256": "..."
      },
      "deltas": [ /* ... */ ]
    }
  }
}
```

> Sparkle 传统用自己的 `appcast.xml` 格式。若采用 Sparkle，可由发布脚本同时生成 `latest.json`（给 electron 端）和 `appcast.xml`（给 Sparkle）。或用 Sparkle 2 对 JSON 的支持。

---

## 5. 组件设计

### 5.1 Electron 主进程更新模块 `electron/updater.ts`（新建，跨平台）

职责:
- 启动后延迟 30s 检查；每 12h 复查；About 对话框打开时即时检查。
- fetch `latest.json`（按 channel），semver 比较。
- 按 `process.platform` + `process.arch` 选资产，计算 `UpdatePath`。
- 暴露统一 IPC: `getStatus / checkNow / downloadAndInstall / onProgress`。
- 内部按平台委托给不同 applier。

```ts
// electron/updater.ts
export type Platform = "win-x64" | "darwin-arm64" | "darwin-x64";
export type UpdatePath = "patch" | "full" | "delta";

export type UpdateStatus =
  | { kind: "up-to-date" }
  | { kind: "available"; path: UpdatePath; version: string; sizeBytes: number; notes: Localized }
  | { kind: "downloading"; progress: number }
  | { kind: "ready"; path: UpdatePath }
  | { kind: "error"; message: string };

// 平台分发
function getApplier(path: UpdatePath): Applier {
  switch (path) {
    case "patch": return winPatchApplier;       // §5.4 (仅 Windows)
    case "full":  return process.platform === "win32" ? winFullApplier : macFullApplier;
    case "delta": return macDeltaApplier;        // §5.6 (仅 macOS, Sparkle)
  }
}
```

### 5.2 IPC 桥接（扩展 `electron/preload.ts`，跨平台统一）

```ts
contextBridge.exposeInMainWorld("synthetix", {
  // ...现有字段...
  update: {
    getStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke("synthetix:update:get-status"),
    checkNow: (): Promise<UpdateStatus> => ipcRenderer.invoke("synthetix:update:check-now"),
    downloadAndInstall: (): Promise<void> => ipcRenderer.invoke("synthetix:update:download-and-install"),
    onProgress: (cb: (s: UpdateStatus) => void) => { /* ipcRenderer.on + 返回 unsubscribe */ },
  },
});
```

渲染层通过 `window.synthetix?.update` 访问（浏览器/自托管 web 模式降级为"不可用"）。

### 5.3 通用下载器（跨平台）

- 下载到 `<userData>/update-staging/`。
- 流式写盘 + 进度回调 + 断点续传（大包友好）。
- sha256 校验。失败清理。

### 5.4 Windows Patch 应用器 `electron/patch-applier.ts`（仅 Windows）

```ts
export async function applyWinPatch(zipPath: string, expectedSha256: string): Promise<void> {
  // 1. 校验 sha256
  // 2. 校验 runtime-hash（护栏，见 §5.7）
  // 3. 优雅关闭 nextServer（释放 .node 句柄 — 否则 EPERM）
  await gracefullyKill(nextServer);
  // 4. 备份 .next/ + public/ + DB
  backupWebLayer(oldVersion); backupDatabase();
  // 5. 解压 content zip 覆盖 resources/app/（per-user 可写，无 UAC）
  extractZip(zipPath, appRoot());
  // 6. 跑迁移（幂等，§7）
  await applyMigrations();
  // 7. 重启 nextServer；waitForServer
  startNextServer(port, dataDir); await waitForServer(port);
  // 8. 失败 → rollbackWebLayer + rollbackDatabase
}
```

content zip 内容边界: ✅ `.next/`、`public/`、变更的纯 JS `node_modules/*`；❌ `runtime/`、`models/`、`workers/python/`、`.node` 文件、`prisma/migrations/`。

### 5.5 Full 安装器

**Windows** `electron/win-full-applier.ts`:
```ts
// NSIS 静默安装: Synthetix-Setup.exe /S /currentuser
spawn(exePath, ["/S", "/currentuser"], { detached: true, stdio: "ignore" });
app.quit(); // NSIS 接管，完成后重启
```

**macOS** `electron/mac-full-applier.ts`:
```ts
// 方式 A: 直接替换 .app（自己实现）
// 1. 解压 zip 到临时目录得到新 Synthetix.app
// 2. codesign verify（校验新包签名有效）
// 3. 关闭 nextServer + app.quit()
// 4. 用 detached shell 脚本: rm -rf /Applications/Synthetix.app && mv new.app /Applications/ && open -a Synthetix
//    （必须在 app 退出后执行，否则替换失败）

// 方式 B: 委托 Sparkle（推荐，省去自己写替换+重启逻辑）
// Sparkle 自动处理下载/校验/替换/重启，见 §5.6
```

> macOS 替换 `.app` 的难点在于**当前应用正在运行不能直接覆盖自己**。标准做法是用一个独立的 helper 脚本/进程在主应用退出后完成替换再重启。Sparkle 内置了这个机制——这是推荐 Sparkle 的重要原因。

### 5.6 macOS Sparkle 集成（可选，推荐）

**Sparkle** 是 macOS 应用更新的事实标准（开源，MIT）。它解决:
- delta 差分（bsdiff，小下载）。
- 整包替换 + 重启（处理"替换正在运行的 .app"的难题）。
- 签名验证（ed25519，独立于 Apple 代码签名）。
- 后台检查 + 用户提示 UI（可定制）。

集成方式:
1. `Sparkle.framework` 拖入 Xcode 项目（或用 cocoapods）。
2. Electron 主进程通过 native addon 或 `electron-sparkle` 桥接（社区有 `electron-updater` 的 Sparkle 集成，或直接用 Sparkle 的 SUUpdater）。
3. 发布端用 `generate_appcasts` 生成 `appcast.xml` + delta 文件。
4. 用 Sparkle 的 ed25519 私钥签名更新包（独立于 Apple Developer ID 签名）。

**何时不引入 Sparkle**:
- macOS 用户量小、更新频率低 → 直接 electron-updater 全量替换 `.app` 更简单（维护成本低）。
- 想要 delta → 必须 Sparkle。

> `electron-updater` 在 macOS 上支持 `.zip`（替换整个 .app）或 `.dmg`，但**不支持 delta**。要 delta 必须 Sparkle。

### 5.7 运行时层 hash 护栏（Windows patch 安全网）

防止"发布者误标 patch 但实际改了原生二进制":

```
runtime-hash = sha256(concat(
  sha256(runtime/node.exe),
  sha256(runtime/python/python.exe),
  sha256List(node_modules/**/*.node),
  sha256List(workers/python/**/*.py)
))
```

写入 `latest.json.platforms[win-x64].patch.minRuntimeHash`。patch 前校验本地 hash 匹配，不匹配**自动降级 full**。

### 5.8 About 对话框 UI 扩展（跨平台共用，路径标签平台不同）

版本网格上方加更新状态徽章，点击展开更新面板:

- **Windows patch**: "快速更新 (~33MB)，无需重新安装"。
- **Windows full**: "完整安装 (~600MB)，将重新安装应用（数据不丢失）"。
- **macOS full**: "更新 (~750MB)，将替换应用（数据不丢失）"。
- **macOS delta**: "增量更新 (~45MB)"。
- 强制更新（`< minRequiredVersion`）: 徽章红色，"立即更新"不可跳过，关闭对话框时拦截并解释。

i18n: `src/lib/i18n/types.ts` 的 `layout.about` 下新增 `update` 子树，en.ts / zh-CN.ts 同步。

顺手修复已知 bug: `about-dialog.tsx:86-87` 的 Runtime 单元格把 label 渲染了两遍（实际值 `techStack` 从未显示）。

---

## 6. 构建与发布流水线（双平台）

### 6.1 当前（手动，仅 Windows）

`scripts/build-electron.mjs` 只跑 `electron-builder --win nsis`。无 macOS。

### 6.2 electron-builder 双平台配置

扩展 `electron-builder.yml`:

```yaml
# 新增 macOS 目标
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
  icon: build/icon.icns          # 需准备 .icns
  # 原生模块: npmRebuild:false 仍生效（standalone Node ABI，非 Electron ABI）
  # 但 macOS 双架构需 darwin-arm64 + darwin-x64 prebuilt 齐全

dmg:
  contents:
    - { x: 130, y: 220 }
    - { x: 410, y: 220, type: link, path: /Applications }

# 发布配置（electron-updater 需要）
publish:
  provider: github
  owner: WalkCloud
  repo: Synthetix
```

**关键约束**:
- `npmRebuild: false` 保持不变（standalone Node 子进程需标准 Node ABI prebuilt）。
- macOS 双架构: `dist/app` 需分别为 arm64 / x64 组装（CPython + Node + 原生模块各一套）。构建矩阵各跑一次。
- `.icns` 图标需准备（从现有 `icon.ico` 转换或重新制作）。

### 6.3 CI 构建矩阵 `.github/workflows/release.yml`

tag push 触发，三矩阵:

```yaml
strategy:
  matrix:
    include:
      - { os: windows-latest, target: win-x64 }
      - { os: macos-latest,   target: darwin-arm64 }
      - { os: macos-13,       target: darwin-x64 }   # Intel runner
steps:
  - 组装 dist/app (平台+架构相关)
  - electron-builder 按目标构建
  - 签名（Windows: Azure Trusted Signing; macOS: Developer ID + 公证）
  - 上传产物到 GitHub Release
```

> macOS x64 用 `macos-13`（Intel runner）；arm64 用 `macos-latest`（Apple Silicon runner）。不能交叉构建（CPython + 原生模块需原生架构）。

### 6.4 发布脚本 `scripts/publish-release.mjs`

1. 读 `package.json` version，校验 git tag。
2. 按 platform/arch 产出: Windows NSIS exe + macOS dmg (arm64/x64) + 可选 delta。
3. 生成 content zip（Windows patch 用，跨平台 JS 层共享一个 zip）。
4. 计算所有资产 sha256 + runtime-hash。
5. 生成 `latest.json`（含三平台资产块）+ 可选 `appcast.xml`（Sparkle）。
6. `gh release create` 上传全部。

patch/full 声明: `--kind patch --from 1.0.1`（Win）/ `--kind auto`（自动检测 runtime-hash）/ `--kind full`（强制全量）。

---

## 7. 数据库迁移手册（跨平台共用，升级最高风险点）

### 7.1 问题

`electron/first-run.ts` 对已存在 DB **跳过迁移**（`console.log("database exists, skipping migration")`）。升级后新版本带新迁移，但 DB 已存在 → 跳过 → schema 漂移 → 服务崩。

### 7.2 修复: 启动前始终迁移（幂等）

迁移脚本（`buildMigrateScript`）**本身幂等**（靠 `_prisma_migrations` 表去重）。问题只是 `runFirstRun` 在 DB 存在时不调用。

```ts
export function runFirstRun(dataDir: string, dbUrl: string): FirstRunResult {
  // ...密钥生成不变...

  // 迁移前备份（DB 存在则备份）
  if (fs.existsSync(dbFile)) {
    const bak = path.join(dataDir, `dev.db.bak-${currentVersion()}`);
    if (!fs.existsSync(bak)) fs.copyFileSync(dbFile, bak);
  }

  // 始终跑迁移（幂等）。DB 不存在则创建；存在则应用未应用的新迁移。
  const res = spawnSync(nodeExe, ["-e", buildMigrateScript(dbFile, migrationsDir)], {...});
  if (res.status !== 0) { rollbackDbBackup(dataDir); throw new Error("migration failed"); }
}
```

patch/full/delta 路径重启 Next 前都会触发迁移，天然兼容跨版本。

### 7.3 迁移编写规范

桌面升级非原子（用户跑混合版本、跳版本）:
- ✅ 向后兼容优先: 加列（nullable/有默认值）、加表、加索引。
- ⚠️ 破坏性迁移分多版: 加新列(v1.1)→双写(v1.1–1.2)→删旧列(v1.3)。
- ⚠️ 不在迁移里跑大表 UPDATE，用应用层 lazy 回填。
- ✅ 测试 N→latest 跳版本路径。

### 7.4 模型/embedding 版本升级

ONNX 权重不在安装包（按需下载到 `%APPDATA%\Synthetix` / `~/Library/Application Support/Synthetix`）。updater 不碰。embedding 模型版本升级时，新版首启检测向量维度不匹配 → 触发 re-index（带进度 UI）。

---

## 8. 安全性（双平台）

> **重要修正**（2026-07-08，基于开源生态实测调研）: 早先版本写"patch 路径必须先做 Windows 代码签名才能上线"——**这个结论过保守，已修正**。实际上 Windows 不签名也能跑自动更新（[electron-builder 官方文档](https://www.electron.build/docs/features/auto-update/) + 社区确认），只是 SmartScreen 弹警告。供应链安全可以用**零成本的 Ed25519 清单签名**独立解决，不依赖 Windows 代码签名体系。

### 8.1 三档签名方案（Windows，按需选择）

开源项目实测分三类（draw.io / Joplin / ComfyUI / OpenRCT2 等的真实做法）:

| 档位 | 成本 | 防篡改 | SmartScreen | 适用 |
|---|---|---|---|---|
| **方案 A: Ed25519 清单签名（推荐，已实现）** | 免费 | ✅ 防 manifest/资产被替换 | ⚠️ 首装/更新弹警告，靠下载量积累信誉 | 开源项目首选，零成本 |
| 方案 B: SignPath Foundation | 免费（需认证） | ✅ + ✅ 消除 SmartScreen | ✅ OV 级，初期短暂信誉期 | 符合条件的 OSS（OSI 许可证、公开仓库、可复现构建） |
| 方案 C: Azure Artifact Signing | ~$10/月 | ✅ + ✅ EV 级立即信任 | ✅ 立即信任，CI 友好 | 商业项目或想省心 |

**方案 A（已实现）**: 自己生成 Ed25519 密钥对，私钥离线保管签 `latest.json`，公钥硬编码进应用验签。详见 §8.3。这样即使 GitHub Release 资产或 CDN 被篡改，应用会拒绝更新。**独立于 Windows 代码签名体系**——借鉴 [Sparkle 的 ed25519 设计](https://blog.doyensec.com/2026/02/16/electron-safe-updater.html) 和 macOS 的成熟先例。

**方案 B（可选，免费合规）**: [SignPath Foundation](https://signpath.org/) 给符合条件 OSS 项目免费提供 OV 签名证书（不验证个人身份，而是验证"二进制确实从开源代码构建"，[OpenRCT2 等已在用](https://openrct2.io/code-signing-policy)）。Synthetix（Apache-2.0、公开仓库、免费分发）基本符合，可复现构建（含 Python 运行时）是唯一可能需要额外工作的点。

**方案 C（可选，付费）**: [Azure Artifact Signing](https://azure.microsoft.com/en-us/products/artifact-signing)（原 Trusted Signing），~$10/月，云 HSM，EV 级 SmartScreen 立即信任，GitHub Actions 友好。

> **当前状态**: Synthetix 采用**方案 A**（已实现，零成本）。full 和 patch 路径现在就能上线。SmartScreen 警告是体验问题不是安全问题——draw.io 等开源项目长期这么过来。后续如想消除警告，可叠加方案 B/C。

### 8.2 macOS 代码签名 + 公证（强制）

macOS 不签名**完全无法运行**（Gatekeeper 拦截），这是与 Windows 的根本区别——与签名档位无关:

- **Apple Developer Program**: $99/年（VERIFY）。
- **Developer ID Application** 证书签 `.app`。
- **Hardened Runtime**（`codesign --options runtime`）: 公证必需。
- **Entitlements（Synthetix 技术栈特有）**:
  - `com.apple.security.cs.allow-jit` — Electron/Node V8 需要。
  - `com.apple.security.cs.disable-library-validation` — onnxruntime/CPython 未签名 dylib 加载需要。
- **公证**: `xcrun notarytool submit` + `xcrun stapler staple`（旧 `altool` 已废弃）。
- **electron-builder `afterSign`**: 接 `electron-notarize` 自动公证。

> macOS 上签名+公证是**全量替换路径的前提**（不签不能跑），不是优化项。patch/delta 不适用于 macOS，所以 macOS 没有额外的签名门槛。

### 8.3 更新包完整性（方案 A: Ed25519 清单签名，已实现）

**已实现**的供应链防护（独立于 Windows 代码签名）:

- **清单签名**: 每资产在 `latest.json` 有 `sha256`，下载后强制校验。`latest.json` 经 HTTPS（GitHub）。**额外**: `latest.json` 整体用 Ed25519 签名，签名覆盖安全关键字段（version + 各资产 url/size/sha256 + runtime hash），应用内置公钥验签。
- **密钥管理**: 私钥存 `~/.synthetix/update-signing.key`（离线，绝不进 git）；公钥生成到 `electron/generated/update-pubkey.ts`（进 git，编译进应用）。`npm run generate:signing-key` 生成。
- **验签行为**: 签名存在但验签失败 → 拒绝更新（防篡改核心）；无签名字段 → warn 放行（前向兼容过渡期，正式启用后建议收紧为强制）。
- **实现文件**: `electron/manifest-signing.ts`（验签）、`scripts/publish-release.mjs`（签名）、`scripts/generate-signing-key.mjs`（密钥生成）、`src/__tests__/scripts/manifest-signing.test.ts`（13 个测试覆盖签名/验签/篡改检测/错误密钥）。
- macOS: Sparkle 自带 ed25519 签名（方案 A 的 macOS 对应物）；full 替换后 `codesign --verify`。
- Windows full: NSIS Authenticode 签名验证（若叠加方案 B/C 后）。

**测试覆盖**（`manifest-signing.test.ts`，13/13 通过）: 签名-验签往返、版本号篡改检测、sha256 篡改、url 篡改（换攻击者主机）、size 篡改、minRuntimeHash 篡改、错误公钥拒绝、非安全字段（releaseNotes/时间戳）可变、无效 JSON、缺字段。

---

## 9. 实施路线（分阶段，双平台并行推进）

### 阶段 1: 地基 + Windows Full（最先交付）

**目标**: 最小可用升级，Windows 用户能一键全量升级。

- [ ] 修复 `first-run.ts`: 始终迁移 + 备份 DB（§7.2）。
- [ ] `electron-builder.yml` 加 `publish` 块。
- [ ] 新建 `electron/updater.ts`: 清单拉取 + semver + Windows full 编排。
- [ ] 扩展 `electron/preload.ts` IPC。
- [ ] About 对话框: 徽章 + 更新面板（full 模式）。
- [ ] `scripts/publish-release.mjs --kind full --platform win`。
- [ ] i18n keys。
- [ ] 测试: 1.0.1→1.1.0 full、跳版本、强制更新拦截。

**产物**: Windows 一键全量升级。

### 阶段 2: macOS 全量替换

**目标**: macOS 用户能升级（前提: 签名+公证打通）。

- [ ] **Apple Developer Program + Developer ID 证书**。
- [ ] `electron-builder.yml` 加 `mac` + `dmg` 配置（arm64 + x64）。
- [ ] 准备 `.icns` 图标。
- [ ] **验证 macOS 双架构 prebuilt 齐全**: `better-sqlite3`/`@node-rs/jieba`/`sharp` 的 darwin-arm64 + darwin-x64。
- [ ] **验证 CPython macOS 方案**: universal2 或分架构 python-build-standalone。
- [ ] `build-installer.mjs` 支持 macOS 组装（CPython/Node/原生模块按架构）。
- [ ] `afterSign` 钩子 + `electron-notarize` 公证。
- [ ] `electron/mac-full-applier.ts`: 替换 `.app` + 重启。
- [ ] CI 矩阵加 macOS job。
- [ ] 测试: Apple Silicon + Intel 升级路径、公证票据 stapled。

**产物**: macOS 一键全量升级。

### 阶段 3: Windows Patch（增量优化）

**目标**: Windows 小更新秒级完成。

- [ ] `electron/patch-applier.ts`: 备份→关服→解压→迁移→重启→回滚。
- [ ] content zip 打包逻辑。
- [ ] runtime-hash 护栏（§5.7）。
- [ ] About patch 模式 UI。
- [ ] **Windows 代码签名上线**（Azure Trusted Signing 或 SignPath）。
- [ ] 测试: 1.0.1→1.0.2 patch、误标 patch 降级 full、patch 失败回滚。

**产物**: Windows 快速增量更新。

### 阶段 4: macOS Delta + 高级特性（可选）

**目标**: macOS 小下载；通道与运维。

- [ ] Sparkle 集成（ed25519 签名 + appcast + delta 生成）。
- [ ] stable/beta 双通道。
- [ ] 下载断点续传。
- [ ] "导出诊断日志"按钮。
- [ ] CI 全自动化发布。

**产物**: macOS 增量更新 + 完整运维。

---

## 10. 文件改动清单

| 文件 | 平台 | 改动 |
|---|---|---|
| `electron-builder.yml` | 共 | 加 `publish` + `mac` + `dmg` + `afterSign` |
| `electron/main.ts` | 共 | 接入 updater（启动检查、更新时关服） |
| `electron/preload.ts` | 共 | 暴露 `window.synthetix.update.*` |
| `electron/updater.ts` | 共 | **新建**: 清单拉取、版本比较、平台分发 |
| `electron/win-patch-applier.ts` | Win | **新建**（阶段3）: patch 应用 + 备份/回滚 |
| `electron/win-full-applier.ts` | Win | **新建**: NSIS 静默安装 |
| `electron/mac-full-applier.ts` | mac | **新建**: 替换 .app + 重启 |
| `electron/first-run.ts` | 共 | 修复: 始终迁移 + 备份 DB |
| `electron/paths.ts` | 共 | 加 `updateStagingDir()`、备份目录辅助 |
| `electron/entitlements.mac.plist` | mac | **新建**: allow-jit + disable-library-validation |
| `src/lib/update-bridge.ts` | 共 | **新建**: 渲染层封装（含浏览器降级） |
| `src/components/layout/about-dialog.tsx` | 共 | 徽章 + 更新面板 + 修 Runtime bug |
| `src/lib/i18n/types.ts` `en.ts` `zh-CN.ts` | 共 | 加 `layout.about.update.*` |
| `scripts/build-installer.mjs` | 共 | 支持 macOS 组装（架构相关） |
| `scripts/publish-release.mjs` | 共 | **新建**: 打包 + 清单 + delta + 上传 + Ed25519 签名 |
| `scripts/generate-signing-key.mjs` | 共 | **新建**: Ed25519 密钥对生成（方案 A） |
| `electron/manifest-signing.ts` | 共 | **新建**: 清单签名/验签（方案 A 核心防篡改） |
| `electron/runtime-hash.ts` | 共 | **新建**: 运行时层指纹（patch 安全护栏） |
| `electron/generated/update-pubkey.ts` | 共 | **生成**: Ed25519 公钥（编译进应用验签） |
| `src/types/electron.d.ts` | 共 | **新建**: `window.synthetix` 全局类型 + `UpdateStatus` 联合类型 |
| `src/__tests__/scripts/manifest-signing.test.ts` | 共 | **新建**: 13 个签名/验签/篡改检测测试 |
| `src/__tests__/scripts/runtime-hash.test.ts` | 共 | **新建**: 5 个 runtime-hash 一致性测试 |
| `build/icon.icns` | mac | **新建**: macOS 图标 |
| `.github/workflows/release.yml` | 共 | **新建**: 三矩阵 CI |
| `package.json` | 共 | 加 `publish`/`publish:beta`/`generate:signing-key` 脚本（不加 `electron-updater` 依赖，全自管） |
| `VERSION` | 共 | **删除**（陈旧，`package.json` 是唯一来源） |

---

## 11. 待决策事项

| 决策点 | 选项 | 建议 |
|---|---|---|
| 首发平台顺序 | Win→mac / 双平台同步 / mac→Win | **Win 先**（已有基础），mac 紧随 |
| macOS delta | Sparkle（delta）/ 仅全量 | **首发仅全量**，delta 阶段4 |
| Windows 代码签名 | Azure Trusted Signing / SignPath(OSS) / 暂不 | patch（阶段3）前**必须签**；full（阶段1）可缓 |
| macOS 签名 | 立即办 Apple Developer / 等用户量 | **阶段2 前必须办**（不签 macOS 完全无法分发） |
| 清单托管 | GitHub Releases 资产 / GitHub Pages | GitHub Releases（与 exe/dmg 同源） |
| 通道 | 仅 stable / stable+beta | 首发 stable |
| CPython macOS 方案 | universal2（单包大）/ arm64+x64 分架构 | 分架构（包小，CI 矩阵已分） |
| `VERSION` 文件 | 删除 / 保留同步 | **删除** |
| Sparkle vs electron-updater（macOS） | Sparkle（含 delta）/ electron-updater（仅全量） | 看 delta 需求；不需要 delta 用 electron-updater 更简单 |

---

## 附: 与现有设计文档关系

- `docs/desktop-packaging-distribution-plan-2026-06-29.md` §阶段6 是上游；本方案细化双平台（上游未区分 Win/mac 的更新策略差异）。
- §阶段7（macOS 专项）的签名公证 entitlements 在本方案 §8.2 落实并补充了更新流程。
- `docs/about-dialog-design-and-compliance-plan-2026-07-08.md` 建立的 About 对话框元数据基础，本方案叠加跨平台更新徽章/面板。
- 迁移手册（§7）落实上游 §阶段6 的"更新时数据库迁移操作手册"，并修复 `first-run.ts` 的跳过迁移 bug。
