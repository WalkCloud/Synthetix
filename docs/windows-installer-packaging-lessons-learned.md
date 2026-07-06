# Windows 安装包封装经验总结

日期：2026-07-01
项目：Synthetix / project01

## 1. 原始问题

安装包选择目录后，安装进度卡在 60% 左右很长时间才能完成。

## 2. 根因分析

### 2.1 electron-builder NSIS 的 7z 整体解压

electron-builder 的 NSIS 安装器把整个 `win-unpacked`（2.2GB）打成一个 7z 压缩包嵌入安装器。安装时 NSIS 必须**先把整个 7z 解压到临时目录**，然后才能复制文件到目标目录。解压 2.2GB 期间进度条完全不动 — 这就是 60% 卡顿的直接原因。

即使 electron-builder 内部已经禁用了 solid compression（`configureDifferentialAwareArchiveOptions` 设置 `solid=false`），7z→NSIS 的两阶段（解压→复制）管道对大 payload 天然慢。

### 2.2 文件数量过多

原始打包方式使用完整 `node_modules`（`next start` 模式）：

| 部分 | 文件数 |
|------|--------|
| node_modules | 29,752 |
| .next (含 dev/cache) | 10,337 |
| Python runtime | 23,389 |
| **总计** | **64,259** |

NSIS 对大量小文件的解压和 NTFS 写入天然慢，加上 Windows Defender 扫描每个文件，进一步拖慢安装。

### 2.3 安装包体积过大

| 组件 | 大小 | 说明 |
|------|------|------|
| Python runtime (含 torch) | 983 MB | torch_cpu.dll 307MB，不可压缩 |
| node_modules | 664 MB | 完整生产依赖 |
| .next | 351 MB | 含 dev/cache 开发缓存 |
| GTE 模型 | 341 MB | ONNX 模型，不可压缩 |
| **解压后总计** | **2.2 GB** | 压缩后 736MB (NSIS) |

## 3. 最终方案

### 3.1 架构

```
pnpm build (standalone)
    ↓
build-installer.mjs 组装 dist/app
    ├── server.js (standalone 入口)
    ├── .next/server + .next/static
    ├── node_modules (standalone traced, pnpm 展平)
    ├── prisma/migrations (SQL 文件)
    ├── workers/python
    ├── runtime/node.exe + python/
    └── models/gte-multilingual-base
    ↓
electron-builder --dir → win-unpacked/
    ↓
Inno Setup (SolidCompression=no) → Synthetix-Setup.exe
```

### 3.2 关键改动

#### 改动 1：Next.js standalone（减少 node_modules 文件数）

`next.config.ts` 加 `output: "standalone"`。

standalone 产出 `server.js` + 只包含运行时实际需要的 node_modules（Next 的 tracing 机制），node_modules 从 29,752 文件降到 3,724。

`electron/main.ts` 改为启动 `node server.js` 替代 `next start`。

#### 改动 2：pnpm 布局展平

standalone 输出的 node_modules 使用 pnpm 的 `.pnpm` 虚拟 store 布局（符号链接）。Node.js 的 `require()` 从目录树向上查找 `node_modules/<name>`，不会查找 `.pnpm/` 内部。

`build-installer.mjs` 在复制 standalone 后，遍历 `.pnpm/<pkg>/node_modules/` 下所有包，复制到顶层 `node_modules/`，使 require 能正常解析。

#### 改动 3：first-run 改用 better-sqlite3（不再依赖 prisma CLI）

standalone tracing 不包含 prisma CLI（它只在 first-run 用，不在 server 运行时用）。而 prisma CLI 的依赖树很深（`@prisma/debug`、`@prisma/config`、`effect`、`iconv-lite` 等），逐个补包非常脆弱。

改为 `electron/first-run.ts` 用 `better-sqlite3` 直接读取 `prisma/migrations/*/migration.sql` 并执行，不再 spawn prisma CLI。

**关键细节**：better-sqlite3 是 native 模块，编译为 Node.js ABI 而非 Electron ABI。不能在 Electron main 进程里直接 `require('better-sqlite3')`。必须用 `spawnSync(bundledNodePath(), ['-e', script])` 在子进程里执行。

#### 改动 4：Inno Setup 替代 NSIS（解决 60% 卡顿）

`packaging/Synthetix-Electron.iss`：
- `SolidCompression=no` — 逐文件解压，进度持续移动
- `Compression=lzma2/normal` — 压缩率和编译速度的平衡
- `PrivilegesRequired=lowest` — per-user 安装，无 UAC
- electron-builder 只用 `--dir` 生成 `win-unpacked`，Inno Setup 做最终打包

#### 改动 5：Python runtime 清理

`build-installer.mjs` 的 `trimPython` 增加删除：
- `torch/include`（9412 个 C++ 头文件，63MB）— 运行时不需要，只有编译扩展才需要
- `torch/lib/*.lib`（导入库，45MB）— 运行时只需 `.dll`
- `torch/bin`、`torchgen` — 构建工具
- `Lib/test`（446 个测试文件，32MB）

## 4. 踩过的坑

### 坑 1：在旧目录上修修补补，不创建干净环境

**问题**：在长期开发的目录里直接打包，历史产物（`dist/Synthetix`、`dist/pkg`、`.next/dev`）容易混入。

**教训**：每次正式打包前删除 `dist/` 和 `.next/`，从干净状态重建。分析文档 `docs/windows-installer-packaging-optimization-analysis.md` 的 P0 建议。

### 坑 2：删掉了 1GB+ 的 runtime 缓存

**问题**：`dist/.runtime-cache` 和 `dist/app/runtime/` 里缓存了准备好的 node.exe + CPython 安装（1GB+），一次误删导致要重新准备。

**教训**：runtime 是手动准备的一次性资源（不在 git 里）。删除 dist 时要保留 `dist/.runtime-cache`。`build-installer.mjs` 有缓存逻辑，但如果缓存和 app 一起被删就没了。

### 坑 3：复制系统 Python 当 runtime

**问题**：用户系统可能没有装 Python，或者版本不对。直接复制系统 Python 不是"傻瓜化"方案。

**正确做法**：准备一个可重定位的 CPython 安装（含所有 pip 包），放到 `dist/runtime/`。系统 Python 3.14 + `pip install -r workers/python/requirements.txt` 可以用，但最终应该用 python-build-standalone 等可重定位发行版。

### 坑 4：iscc 编译超时

**问题**：iscc 用 `lzma2/ultra` 压缩 2.2GB payload 需要很长时间（>10分钟），容易超时。用 `/Q` 静默模式在后台运行时进程检测不可靠。

**教训**：
- 用 `lzma2/normal` 而非 `lzma2/ultra`（编译时间从 >10分钟降到 ~9分钟）
- 不用 `/Q`，直接输出到日志文件，轮询检查 `Successful compile` 字符串
- iscc 编译 2.2GB 大约需要 8-10 分钟，要给足够时间

### 坑 5：iscc 编译被中断产出残缺安装器

**问题**：iscc 超时被杀后，可能已经生成了一个不完整的 `.exe` 文件。这个残缺文件能被 Windows 识别为 PE32 可执行文件，但运行时报 "setup files are corrupted"。

**教训**：删除旧安装器后再编译。检查 iscc 日志是否有 `Successful compile` 才认为完成。

### 坑 6：Inno Setup `PrivilegesRequired=admin` 在自动化测试中失败

**问题**：`PrivilegesRequired=admin` 需要 UAC 提权，silent 安装（`/SILENT`）无法获得 UAC 确认，导致安装失败（exit 1）。

**教训**：per-user 应用用 `PrivilegesRequired=lowest`，默认装到 `%LOCALAPPDATA%\Programs\`，无 UAC。如果需要装到 `C:\Program Files`，用户正常双击安装器时会有 UAC 弹窗（正常 Windows 行为），但自动化测试用 `lowest` 更方便。

### 坑 7：standalone tracing 在 pnpm 布局下遗漏包

**问题**：Next.js standalone 的 tracing 在 pnpm 符号链接布局下，遗漏了通过 `package.json` exports map 解析的子路径。最典型的是 `@swc/helpers/_/_interop_require_default` — standalone 只复制了 `cjs/` 目录，没复制 `_/` 子目录。

**教训**：standalone + pnpm 需要展平 `.pnpm` store 到顶层 `node_modules`。展平时要遍历每个 `.pnpm/<entry>/node_modules/` 下的**所有**包（一个 entry 可能包含多个包，如 `pg-types@2.2.0/node_modules/` 下有 pg-types、pg-int8、postgres-array 等）。

### 坑 8：pnpm 符号链接在 Windows 上的 EPERM

**问题**：`fs.realpathSync()` 在 Windows 上对 pnpm 的 junction/symlink 会抛 EPERM。

**教训**：用 `fs.readlinkSync()` + `path.resolve()` 手动解析符号链接，而非 `realpathSync`。解析失败时跳过（broken symlink）而非崩溃。

### 坑 9：better-sqlite3 的 ABI 不兼容

**问题**：在 Electron main 进程里 `require('better-sqlite3')` 会失败，因为 better-sqlite3 编译为 Node.js ABI，而 Electron main 进程使用 Electron 的 ABI。

**教训**：native 模块在 Electron main 进程里使用时，必须用 `npmRebuild: true` 重新编译为 Electron ABI，或者放到子进程里用 bundled `node.exe` 执行。first-run 的数据库创建用子进程方案更简单。

### 坑 10：electron-builder 的 NSIS 内部压缩不可控

**问题**：electron-builder 的 NSIS 安装器内部使用 7z 压缩，无论 `compression` 设为 `maximum` 还是 `normal`，都是先把 `win-unpacked` 打成一个 7z 再嵌入 NSIS。安装时必须整体解压 7z，无法逐文件解压。

**教训**：对于大 payload（>1GB），不要用 electron-builder 的 NSIS。用 `--dir` 只生成 `win-unpacked`，然后用 Inno Setup 的 `SolidCompression=no` 做最终打包。

## 5. 最终打包流程

### 5.1 前置准备（一次性）

1. 系统 Python 已安装 `pip install -r workers/python/requirements.txt`
2. Inno Setup 已安装（`winget install JRSoftware.InnoSetup`）
3. `dist/runtime/` 已准备好 `node.exe` + `python/`（可重定位副本）

### 5.2 打包步骤

```bash
# 1. 清理
rm -rf .next dist/app dist/electron dist/installer dist/.runtime-cache

# 2. Next.js standalone 构建
npx next build

# 3. 组装 dist/app（含 standalone + pnpm 展平 + Python 清理 + runtime）
node scripts/build-installer.mjs --no-build

# 4. 编译 Electron TS
npx tsc -p electron/tsconfig.json

# 5. electron-builder 打包 win-unpacked
npx electron-builder --win --dir --config electron-builder.yml

# 6. Inno Setup 编译安装器
iscc packaging/Synthetix-Electron.generated.iss
```

### 5.3 验证

```bash
# 安装（silent）
Synthetix-Setup-v0.10.9.exe /SILENT /DIR=<path>

# 检查
# - 安装完成 exit 0
# - Synthetix.exe 存在
# - 启动后 HTTP 200
# - dev.db 已创建
# - server.log 有 "Ready"
```

## 6. 关键文件清单

| 文件 | 作用 |
|------|------|
| `next.config.ts` | `output: "standalone"` |
| `scripts/build-installer.mjs` | 组装 dist/app + pnpm 展平 + Python 清理 |
| `electron/main.ts` | 启动 `server.js` 替代 `next start` |
| `electron/first-run.ts` | better-sqlite3 子进程执行 migrations |
| `electron-builder.yml` | `compression: normal`，`--dir` 模式 |
| `packaging/Synthetix-Electron.iss` | Inno Setup: `SolidCompression=no` |

## 7. 未来优化方向

1. **进一步精简 Python runtime** — 删除 `pygments`、`lightrag/api/webui`、`openai/types` 等运行时不需要的子目录（约 5000 文件）
2. **删除 `.pnpm` 目录** — 展平后顶层已有所有包，`.pnpm` 是冗余的（约 1900 文件）
3. **代码签名** — 减少 SmartScreen 和杀软干扰
4. **python-build-standalone** — 替代系统 Python 复制，确保可重定位
5. **安装耗时 benchmark** — 在 HDD/SSD、Defender 开关状态下分别测试
