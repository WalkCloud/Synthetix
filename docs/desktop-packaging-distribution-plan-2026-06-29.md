# Synthetix 桌面应用打包与发布方案

> **目标**：让非技术用户双击 `Synthetix-Setup.exe`（Windows）或 `Synthetix.dmg`（macOS），选择安装路径后，所有组件（Node 服务、Python RAG worker、SQLite 数据库、LLM 配置）即装即用，无需任何额外环境。
>
> **结论先行**：采用 **Electron 客户端壳 + 复用现有打包基础设施** 的方案，而非浏览器打开方式。理由见 §2。
>
> **调研说明**：本方案的市场调研因调研环境 WebFetch 全部失败，**所有版本号、价格、安装包大小均为训练知识，未经实时核验**，落地前需对 §2.2 表格、§4 阶段 5 的证书价格、§5 的体积估算重新核实。架构性结论（Electron sidecar 机制、ComfyUI 捆绑 Python 先例、签名公证流程、更新时迁移策略）置信度较高。

---

## 1. 现状盘点（基于当前代码库）

当前仓库已有一套**浏览器打开式**的 Windows 安装程序，作为本方案的基础和对比基准。

### 1.1 现有 Windows 打包链路

| 环节 | 文件 | 现状 |
|---|---|---|
| 安装脚本 | `packaging/Synthetix.iss` | Inno Setup，per-user 安装到 `%LOCALAPPDATA%\Programs\Synthetix`，免 UAC |
| 构建编排 | `scripts/build-installer.mjs` | 一键脚本：`next build` → 组装 `dist/app`（Node + .next + node_modules + CPython + workers + prisma + 启动器）→ 裁剪 → `iscc` 编译 |
| 启动器 | `packaging/start.bat` | 设环境变量 → 跑 `first-run.js` → `next start -p 3000` → 打开浏览器 |
| 首次初始化 | `packaging/first-run.js` | 幂等：生成 `JWT_SECRET`/`ENCRYPTION_KEY` → `prisma migrate deploy` 建库 |
| 停止 | `packaging/stop.bat` | 杀掉占用 3000 端口的进程 |

**已具备的能力**（可直接复用到客户端方案）：
- ✅ 捆绑完整 `node.exe` + CPython 运行时，目标机器零依赖
- ✅ Python 运行时激进裁剪（`trimPython` 移除 AWS SDK / torchvision / opencv / pip / CPython 非运行目录）
- ✅ 首次运行自动生成密钥、自动建库（`prisma migrate deploy`）
- ✅ 版本号以 `package.json` 为唯一来源
- ✅ Python 通过单一 `PYTHON_PATH` 环境变量抽象（`src/lib/python.ts:11`），切换到冻结构建或自带运行时只需改这一处

**现有方案的体验缺陷**（本方案要解决的）：
- ❌ 启动后弹出一个**黑色 cmd 窗口**，提示"keep this window open；close it to stop the server"——对非技术用户是认知负担
- ❌ 关闭窗口即停服务，没有托盘、没有后台守护
- ❌ 浏览器标签页混在用户的普通网页里，易被误关
- ❌ 仅 Windows（`.bat`/Inno Setup 无 macOS 对应物）
- ❌ 无代码签名 → Windows SmartScreen 拦截、macOS 无法构建
- ❌ 无自动更新 → 用户要手动卸载重装
- ❌ 原始产品决策（`docs/requirements-analysis.md`）明确写过"不做桌面安装版"，但后来还是做了 Inno Setup 版——说明浏览器式体验不达标，需要演进到客户端

---

## 2. 浏览器打开 vs 客户端打开：决策

### 2.1 两种形态的实质

无论哪种，Synthetix 的运行时架构不变——都是**本地起一个 Next.js 服务 + Python worker，前端通过 HTTP 访问**。区别只在前端的"壳"：

```
浏览器式（现状）：  Electron 客户端式（推荐）：
  start.bat          Synthetix.exe (Electron main)
    ↓                  ↓ spawn
  next start          next start (后台进程，无窗口)
    ↓                  ↓
  浏览器打开           BrowserWindow.loadURL(localhost:PORT)
  localhost:3000       ↑ 进程内嵌窗口，应用感
```

### 2.2 主流本地 AI 应用的实际做法（市场调研）

> ⚠️ 以下安装包大小为训练知识估算，**未经实时核验**，落地前需逐个核实。

| 应用 | 壳技术 | 后端运行时 | 安装包大小 | 模型/依赖处理 |
|---|---|---|---|---|
| **Obsidian** | Electron | 内嵌 Node | ~80 MB（VERIFY） | 纯 JS，无 Python，无 ML |
| **Jan.ai** | Electron | 内嵌 Nitro（C++/llama.cpp）sidecar | ~150–250 MB（VERIFY） | 模型按需下载到用户目录 |
| **LM Studio** | Electron | 内嵌 llama.cpp 引擎 | ~300–400 MB（VERIFY） | 模型按需下载 |
| **AnythingLLM Desktop** | Electron | 内嵌 Node + Prisma，曾捆绑 Python collector | ~300–500 MB（VERIFY） | **与 Synthetix 最接近的类比**（Node + Prisma + Python + RAG） |
| **GPT4All** | Qt（非 Electron） | C++/llama.cpp | ~700 MB–1 GB（VERIFY） | 模型按需下载 |
| **ComfyUI Desktop** | Electron | **捆绑可重定位 CPython + pip 装 wheels** | — | **捆绑 Python 的最强先例**：因冻结 torch/onnx 太脆弱而选捆绑 |

**关键共性结论**：
- 主流本地 AI 应用**清一色用客户端壳**，没有一家靠"起服务+浏览器打开"作为发行形态。
- **绝大多数避免捆绑 Python**——靠 llama.cpp（C/C++）或 ONNX 原生绑定绕过。但 Synthetix 的 docling/sentence-transformers/onnxruntime 是核心、不易用 JS 重写，因此走 **ComfyUI 先例（捆绑可重定位 CPython）** 是务实路径，而非 PyInstaller 冻结。
- 模型权重**从不进安装包**，一律按需下载到用户数据目录。
- Synthetix 落地体积**现实预期 400–800 MB**（VERIFY），取决于 CPU-only 还是含 CUDA、模型权重是否随包。

### 2.3 为什么客户端更适合 Synthetix

| 维度 | 浏览器式（现状） | Electron 客户端式 |
|---|---|---|
| 启动 | 黑窗口 + 浏览器标签 | 双击图标，无可见终端 |
| 服务生命周期 | 关窗口即停 | 托盘常驻，关闭窗口最小化 |
| 浏览器干扰 | 与用户网页混在一起 | 独立窗口，应用感 |
| 端口冲突 | 3000 被占要手动改 | 主进程自动选可用端口 |
| 首次配置 | 已自动化（first-run.js） | 复用，可在 Electron 主进程里跑 |
| 自动更新 | 无 | electron-updater |
| 跨平台 | 仅 Windows | Win + macOS + Linux |
| 系统集成 | 无 | 托盘、通知、文件关联、深链 |
| 非技术用户友好度 | 低 | 高 |

### 2.4 为什么选 Electron 而非 Tauri

| 项 | Electron | Tauri |
|---|---|---|
| 后端 runtime | 自带 Node（主进程即 Node） | Rust，需自己起 Node/Python sidecar |
| 与现有后端契合 | ✅ Next.js/Node 直接复用 | ⚠️ 需写 Rust 桥接，且要把 Node 服务编译成单可执行文件（SEA/pkg） |
| 原生模块（better-sqlite3/@node-rs/jieba） | ✅ 直接 rebuild | ⚠️ 子进程里另起 Node |
| Python sidecar | spawn 即可 | 支持 sidecar，但 Python 仍需自行打包 |
| 安装包体积 | ~80–150 MB 壳（含 Chromium+Node） | ~3–10 MB 壳（用系统 WebView） |
| 自动更新 | electron-updater（成熟，Windows 块级差分） | plugin-updater（较新，差分有限） |
| 生态成熟度 | 极成熟（VS Code/Slack/Obsidian/Notion 等） | 成熟但大型部署较少 |

**关键判断**：Tauri 壳本身虽小（省下 ~80 MB Chromium），但 Synthetix 必须捆绑 Node 运行时（跑 Next 服务）和 Python 运行时（跑 RAG worker）——**这两块才是体积大头**（CPython + docling/lightrag/sentence-transformers 已达数百 MB）。Tauri 省下的 Chromium 体积是边际收益，却要付出：①把 Node 服务编译成单可执行文件（SEA/pkg）；②写 Rust 桥接、管理两个 sidecar；③更年轻的更新生态。**Electron 自带 Node，可直接在主进程里 spawn Next standalone server 和 Python daemon，迁移成本最低**，故选 Electron。

> Tauri 仅在"安装包体积或内存是硬约束"时才值得考虑，且需先把 Node 后端编译成单可执行文件并接受双 sidecar 管理成本。

> 包体确实是 Electron 的劣势，但对本地重型 AI 工具是行业可接受代价（见 §2.2，同类应用 100 MB–1 GB）。

---

## 3. 最终架构

```
Synthetix.exe / Synthetix.app  (Electron)
│
├─ main process（主进程）
│   ├─ 首次运行引导（复用 first-run.js 逻辑）
│   ├─ 选可用端口 → spawn Next standalone server（无窗口）
│   ├─ spawn Python daemon（PYTHON_PATH 指向自带 python.exe）
│   ├─ 健康检查 → BrowserWindow.loadURL
│   ├─ 单实例锁、托盘、优雅退出
│   └─ electron-updater 检查更新
│
├─ renderer（渲染进程）
│   └─ BrowserWindow 加载 http://127.0.0.1:<port>（现有 UI 零改动）
│
└─ 捆绑运行时（resources/app/）
    ├─ runtime/node.exe           ← 复用现有
    ├─ runtime/python/            ← 复用现有裁剪后的 CPython
    ├─ .next/ + node_modules/     ← next build 产物
    ├─ workers/python/            ← RAG worker 脚本
    ├─ prisma/migrations/         ← 11 个迁移
    └─ first-run.js               ← 复用现有
```

**核心原则**：渲染层（前端 UI）和后端（Next API + Python）零改动，只在外层加 Electron 主进程作为生命周期管理者。

---

## 4. 实施工作清单

按依赖顺序分七个阶段，每阶段产出可验证的中间产物。

### 阶段 1：Next.js standalone 化（生产构建独立运行的前提）

当前 `next.config.ts` 用的是默认输出（`next start` 需要完整 `node_modules`）。改为 standalone 可大幅瘦身。

- [ ] `next.config.ts` 加 `output: "standalone"`
- [ ] 验证 standalone 产物含 `@prisma/client` 查询引擎二进制（win-x64 / darwin-arm64 / darwin-x64）和 `src/generated/prisma`
- [ ] 验证 `better-sqlite3`、`@node-rs/jieba`、`sharp` 的 prebuilt 二进制对三个目标平台齐全；跨平台打包时按目标 `npm rebuild`
- [ ] 干净机器上 `node .next/standalone/server.js` 能起，覆盖原 `next start` 路径
- [ ] **风险**：之前的会话记忆里踩过 EPERM 和缺 Prisma 依赖的坑，standalone 化要彻底验证

**产物**：可独立运行的 Next 服务目录，为 Electron spawn 提供输入。

### 阶段 2：Python worker 打包优化（包体与稳定性最大变量）

现状是捆绑完整 CPython + 依赖（`runtime/python/`）。**调研结论：保持"捆绑可重定位 CPython"路线，不要走 PyInstaller 冻结。** 最强先例是 ComfyUI Desktop——它同样面对 torch/onnx 的动态加载，特意选择捆绑 Python 而非冻结，因为 PyInstaller 冻结 torch/onnxruntime 太脆弱（动态 `importlib`、动态库加载、模型缓存路径等频繁出错）。

四个方案对比：

| 方案 | 适用 | 风险 |
|---|---|---|
| **A. 捆绑可重定位 CPython（推荐，现状演进）** | 重 ML 依赖、动态加载多 | 低 — 真实解释器，动态加载天然支持 |
| B. PyInstaller 冻结 | 依赖集小且稳定 | 高 — onnxruntime/torch 动态加载易崩，AV 误报，体积未必更小 |
| C. Nuitka 编译 | 要混淆/提速 | 中 — 编译慢，仍要带数据文件 |
| D. PyOxidizer | Tauri 嵌 Python | 高 — 2023 后维护明显放缓，不推荐 |

**演进动作**：
- [ ] **将 CPython 源切换为 `python-build-standalone`**（Astral/indygreg，pre-built 可重定位 CPython，设计目的就是可复制移动）。现有 `trimPython` 裁剪逻辑保留。这比 `python.org` 官方 embeddable 更适合做 sidecar，且跨平台一致。
- [ ] 预装 CPU-only wheels（docling/lightrag-hku/sentence-transformers/optimum[onnxruntime]）进 `runtime/python/`，**不随包带 CUDA/cuDNN**（多个 GB）
- [ ] GPU 支持：默认 CPU-only；检测到 GPU 时**按需下载 CUDA wheels**（用户 opt-in），保持基础包小
- [ ] 模型权重（sentence-transformers 模型）统一做成首次启动按需下载到用户数据目录，**不进安装包**
- [ ] `PYTHON_PATH`（`src/lib/python.ts:11`）指向自带 `python.exe`/`python3`，调用方零改动
- [ ] `src/lib/python-daemon.ts:31` 的 `path.resolve("workers/python/daemon.py")` 需改为基于 `app.getAppPath()` 的绝对路径，避免打包后 cwd 不对

**产物**：体积可控、可跨平台、动态加载稳定的 Python 运行时方案。

> ⚠️ 体积现实预期 400–800 MB（VERIFY）。若硬性要压到 300 MB 内，才考虑 PyInstaller，但需 CI 上对两个平台完整回归测试 onnxruntime/docling 的动态加载。

### 阶段 3：Electron 主进程壳

新建 `electron/` 目录：

- [ ] `electron/main.ts`：
  - 启动时调 `first-run.js`（复用现有逻辑，密钥生成 + `prisma migrate deploy`）
  - 选可用端口（避开 3000 占用）
  - `spawn(node, [standalone/server.js])` 起 Next 服务
  - 健康轮询 `http://127.0.0.1:<port>/api/health` 就绪后 `BrowserWindow.loadURL`
  - `app.requestSingleInstanceLock()` 单实例
  - 退出时优雅 kill Next + Python daemon
- [ ] 托盘图标（关闭窗口最小化到托盘，不杀服务）
- [ ] 开发模式走 `next dev`，生产模式走 standalone server（`electron-is-dev` 切换）
- [ ] 数据目录迁移到用户目录（不再写安装目录）：
  - Windows: `%APPDATA%\Synthetix`
  - macOS: `~/Library/Application Support/Synthetix`
  - `DB_PATH`/`DOCUMENT_ROOT` 指向用户目录，避免卸载丢数据、避免 Program Files 只读问题

**产物**：可双击启动的 Electron 壳，前端零改动。

### 阶段 4：首次运行引导（强化现有 first-run.js）

现有 `first-run.js` 已自动生成密钥和建库。Electron 版需补：

- [ ] 引导窗口（非浏览器）：首次启动显示"正在初始化工作区"进度
- [ ] 数据目录不存在则创建并设权限
- [ ] 自动生成 `JWT_SECRET`（随机 40 字符）、`ENCRYPTION_KEY`（40 字符）
- [ ] `prisma migrate deploy`（用打包的 11 个迁移，**不是** `migrate dev`）
- [ ] 初始化失败时给出可读错误 + 导出诊断日志按钮

**产物**：非技术用户零配置开箱即用。

### 阶段 5：打包与签名

用 `electron-builder`，三平台目标：

- [ ] Windows：`nsis` 目标，per-user 安装（延续现有免 UAC 策略）
- [ ] macOS：`dmg` 目标，`arm64` + `x64` 双架构
- [ ] （可选）Linux：`AppImage`

**Windows 代码签名**（⚠️ 价格未实时核验）：

> **重要背景**：自 2023-06-01 起，微软要求所有新 OV 证书必须签发到**硬件 USB token**上，不能再下载证书文件——这会破坏 CI 自动签名。

| 方案 | 价格（VERIFY） | SmartScreen 行为 | CI 友好度 |
|---|---|---|---|
| **Azure Trusted Signing（推荐）** | ~$9.99/月 | 立即信任（EV 级，无需累积信誉） | ✅ 云 HSM，GitHub Actions 用 `azure/trusted-signing-action` |
| EV 证书 | ~$300–700/年 | 立即信任 | ⚠️ 需 USB HSM，CI 要自托管 runner 或远程签名服务 |
| OV 证书 | ~$200–400/年 | **仍触发 SmartScreen**，需累积信誉（数周，不透明） | ⚠️ 需 USB token |
| 不签名 | 免费 | 全量拦截 + AV 误报 | — |

- [ ] 优先选 **Azure Trusted Signing**：云 HSM 解决 USB token/CI 问题，微软签名证书获立即 SmartScreen 信任
- [ ] OSS 替代：**SignPath.io** 对认证 OSS 项目免费
- [ ] 不签名对非技术用户基本不可行（SmartScreen 警告劝退）

**macOS 签名公证**（必需，否则 Gatekeeper 拦截）：

- [ ] Apple Developer Program 会员（$99/年，VERIFY）
- [ ] `codesign --options runtime`（Hardened Runtime，公证必需）
- [ ] `xcrun notarytool submit` 提交公证 + `xcrun stapler staple` 装订票据（旧 `altool` 已废弃）
- [ ] electron-builder 的 `afterSign` 钩子接 `electron-notarize`
- [ ] **关键：Entitlements（你的技术栈特有）**：
  - `com.apple.security.cs.allow-jit` — Electron/Node 的 V8 需要
  - `com.apple.security.cs.disable-library-validation` — onnxruntime/torch 的未签名 dylib 加载需要
  - 文件/网络访问 entitlements 按需
- [ ] 需要 **Developer ID Application** 证书（签 `.app`），可选 Developer ID Installer（签 `.pkg`），都在 $99/年 program 内

**跨平台构建**：用 **GitHub Actions 矩阵**（`windows-latest` + `macos-latest`），签名材料存为 Actions secrets，不提交到仓库。

**产物**：签名公证过的 `Synthetix-Setup-vX.exe` 和 `Synthetix-vX.dmg`。

### 阶段 6：分发与自动更新

- [ ] **下载渠道**：GitHub Releases（免费、自带校验和）；自定义域名挂静态站
- [ ] **自动更新**：`electron-updater` + GitHub Releases 的 `latest.yml`/`latest-mac.yml`
  - 每次发版 CI 自动生成更新清单
  - Windows 支持块级差分更新；macOS 替换 `.app`
  - `update-downloaded` 事件后提示用户 → `quitAndInstall` 退出并重启
- [ ] **更新时的数据库迁移（关键操作手册）**：
  - updater 只替换 app 二进制，用户数据（SQLite `dev.db`、embeddings、模型缓存）在用户数据目录**持久保留**，风险是 schema 漂移
  - ① **启动时同步迁移**：后端服务启动**之前**跑 `prisma migrate deploy`（用打包进资源的 11 个迁移，离线可用），绝不让后端服务连未迁移的库
  - ② **迁移前备份**：`dev.db` → `dev.db.bak-<version>`；迁移失败时回滚并报错，而非服务半迁移的库
  - ③ **向后兼容迁移**：加列/可空字段优先；桌面更新**非原子**，用户跑混合版本，破坏性迁移要谨慎 gating
  - ④ **单实例锁**：避免更新后旧后端仍在服务
  - ⑤ **支持 N→latest**：桌面用户会跳版本，需测每个历史版本到当前的升级路径，不是只测 N→N+1
  - ⑥ **Python sidecar 版本锁步**：sidecar 与 shell 同一个安装包一起更新，版本不漂移
- [ ] **模型/embedding 更新**：权重不在安装包里，updater 不碰；仅当 embedding 模型版本升级时，新版本首次启动触发 re-index 迁移任务（带进度 UI）
- [ ] **日志与诊断**：Next 日志 + Python worker 日志写用户目录，提供"导出诊断日志"按钮便于排查
- [ ] **更新通道**：stable / beta，便于灰度

**产物**：用户可一键升级，无需手动卸载重装，且数据/schema 安全迁移。

### 阶段 7：macOS 专项（最后做，最容易卡）

- [ ] Python 运行时用 `python.org` 的 macOS universal2 或自建 framework
- [ ] `better-sqlite3`/`@node-rs/jieba`/`sharp` 的 darwin-arm64 + darwin-x64 prebuilt 齐全性确认
- [ ] Gatekeeper + 公证全流程跑通
- [ ] Apple Silicon 与 Intel 双架构 `dmg`

**产物**：macOS 可分发版本。

---

## 5. 关键风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Python heavy deps（docling/onnxruntime）动态加载 | PyInstaller 冻结后崩溃 | **保留捆绑 CPython 方案**（ComfyUI 先例），不做冻结；改用 `python-build-standalone` |
| 安装包体积过大（预期 400–800 MB，VERIFY） | 下载劝退 | 模型权重按需下载；CPU-only 默认，CUDA 按需；Python 裁剪；standalone 瘦身 |
| macOS 公证流程卡 | 无法发版 | 提前办 Apple Developer；预留 1–2 周调通 entitlements（V8 JIT / onnx 库验证） |
| SmartScreen 信誉期（若用 OV 证书） | 早期用户被拦 | 用 **Azure Trusted Signing**（EV 级立即信任，免 USB token，CI 友好） |
| better-sqlite3 跨平台 rebuild | 平台包缺失 | CI 矩阵按目标平台 `npm rebuild`，不跨平台编译 |
| standalone 缺 Prisma 引擎 | 启动失败 | 显式 copy 查询引擎二进制 + generated client |
| 更新时 schema 漂移 | 数据损坏/服务崩 | 启动前同步迁移 + 迁移前备份 + 向后兼容 + N→latest 测试 |
| Python sidecar 与 Node 版本不同步 | 行为不一致 | sidecar 与 shell 同一安装包锁步更新 |
| Electron 体积（~80–150 MB 壳） | 包体大 | 对本地 AI 工具是行业可接受代价（见 §2.2） |

---

## 6. 推荐推进顺序（资源有限时）

每步独立产出可用产物，可随时停在某个阶段交付：

1. **阶段 1 + 4**：Next standalone + 首次引导强化 → 即便不上 Electron，也能产出"解压即用"便携版（接近现有 Inno Setup 状态的改进版）
2. **阶段 3**：套 Electron 壳，先 Windows 跑通 → 真正的双击即用客户端
3. **阶段 2**：Python 打包优化 → 控包体、提稳定性
4. **阶段 5（Windows 部分）+ 6**：签名 + GitHub Releases 分发 + 自动更新 → 可公开发行
5. **阶段 5（macOS）+ 7**：macOS 签名公证 → 双平台覆盖

---

## 7. 需要决策的事项

在动手前需明确以下几点，会显著影响工作量：

| 决策点 | 选项 | 影响 |
|---|---|---|
| 安装包体积上限 | 接受 400–800 MB / 硬压到 300 MB 内 | 决定 Python 是否冒险走 PyInstaller（不建议）vs 捆绑 CPython |
| Apple Developer 账号 | 办（$99/年）/ 不办 / 首发只做 Windows | 决定 macOS 能否发版 |
| Windows 代码签名 | Azure Trusted Signing（~$9.99/月，推荐）/ EV 证书 / OV 证书 / 不签 | 决定 Windows 首发体验与 CI 复杂度 |
| 首发平台 | 仅 Windows / Win+macOS 同发 | 决定阶段 5/7 优先级 |
| 自动更新 | 首发 / 后续迭代 | 决定阶段 6 何时介入 |
| GPU 支持 | 仅 CPU / CPU+按需下载 CUDA | 影响包体与首启下载量 |

---

## 附：现有可复用资产清单

迁移到 Electron 时**不要重写**以下，直接复用：

- `packaging/first-run.js` — 密钥生成 + 建库逻辑（移入 Electron 主进程）
- `scripts/build-installer.mjs` 的 `trimPython` — Python 裁剪逻辑
- `scripts/build-installer.mjs` 的 bundle 组装逻辑 — 改为组装进 Electron `resources/app`
- `src/lib/python.ts:11` 的 `PYTHON_PATH` 抽象 — 只改指向，不改调用方
- `prisma/migrations/` — 11 个迁移，`migrate deploy` 直接用
- 版本号单一来源（`package.json`）— electron-builder 原生支持
