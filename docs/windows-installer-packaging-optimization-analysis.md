# Windows 安装包封装问题分析与优化方案

日期：2026-07-01
项目：Synthetix / project01

## 1. 背景与目标

当前程序需要打包成 Windows 安装包，目标用户应当能够直接点击 `.exe` 或 `.msi` 完成安装。安装过程中不应再下载依赖、下载模型、执行构建或进行其他耗时准备工作。

当前用户反馈的核心问题是：安装程序经常在约 60% 进度处长时间卡住，安装体验差。初步判断是安装包内文件数量过多，尤其是大量 `node_modules` 小文件导致 NSIS 安装阶段解压和写入速度很慢。

本文件基于当前代码和打包配置，对问题原因、风险点和优化方案进行分析。

## 2. 当前检查结果摘要

在当前工作区中，几个关键目录的统计结果如下：

```text
node_modules:
  files = 64,952
  dirs  = 12,039
  size  = 1,671.8 MB

.next:
  files = 10,337
  dirs  = 517
  size  = 5,398.4 MB

.next/dev:
  files = 8,504
  size  = 5,056.1 MB

dist:
  files = 40,660
  dirs  = 4,458
  size  = 1,872.9 MB
```

历史构建产物中也发现了明显污染：

```text
dist/Synthetix/app/.next/dev:
  files = 1,670
  size  = 875.2 MB

dist/pkg/app/node_modules:
  files = 35,496
  size  = 721.2 MB
```

本地模型目录：

```text
data/models/gte-multilingual-base:
  files = 5
  size  = 340.8 MB
```

模型文件数量少，主要影响安装包体积，不是 6 万多个小文件的主要来源。

## 3. 当前封装方案概述

当前项目中同时存在几条 Windows 打包相关路径：

- `electron-builder.yml`
- `scripts/build-electron.mjs`
- `scripts/build-installer.mjs`
- `packaging/Synthetix.iss`
- `electron/main.ts`
- `electron/paths.ts`

当前 Electron 方案的核心思路是：

```text
Electron shell
  -> 启动 bundled node.exe
    -> next start
      -> 依赖 .next + node_modules + prisma + workers + python runtime + model
```

`electron-builder.yml` 中通过 `extraResources` 将 `dist/app` 整体复制进安装包：

```yml
extraResources:
  - from: dist/app
    to: app
    filter:
      - "**/*"
```

也就是说，最终 Electron 安装后的结构大致是：

```text
<install>/Synthetix.exe
<install>/resources/app/.next
<install>/resources/app/node_modules
<install>/resources/app/prisma
<install>/resources/app/workers
<install>/resources/app/runtime/python
<install>/resources/app/models/gte-multilingual-base
```

该方案优点是目标机器不需要单独安装 Node.js、Python 或模型文件。缺点是安装包内文件多、体积大，安装阶段解压和写入非常慢。

## 4. 核心问题判断

### 4.1 大量小文件是安装卡顿的主要原因

当前根目录 `node_modules` 有约 65,000 个文件，历史生产打包目录中的 `node_modules` 仍有约 35,000 个文件。

NSIS 安装器处理这类目录时会遇到几个问题：

1. 大量小文件写入 NTFS 本身较慢。
2. Windows Defender 或其他杀毒软件会扫描大量 `.js`、`.node`、`.exe`、`.dll` 文件。
3. NSIS solid compression / maximum compression 解压进度不线性，容易在某个百分比长时间停住。
4. `node_modules` 中包含很多运行时不需要的文档、源码、source map、测试、示例和跨平台二进制。

因此，“约 64,000 个文件导致 NSIS 安装时解压和写入过慢”这个判断方向是正确的。

### 4.2 `.next/dev` 是高危污染源

当前 `.next/dev` 体积超过 5GB：

```text
.next/dev = 5,056.1 MB
```

这类开发服务器缓存和开发产物绝对不应该进入安装包。历史产物 `dist/Synthetix/app/.next/dev` 也曾出现过 875MB 的污染。

虽然当前 `scripts/build-installer.mjs` 中已经有排除逻辑：

```js
copyDirExcluding(
  path.join(ROOT, ".next"),
  path.join(APP, ".next"),
  ["dev", "cache", "trace"]
);
```

但历史产物说明构建流程中仍存在使用旧目录、旧脚本或脏产物的风险。

### 4.3 当前封装方式仍然偏重

当前 `scripts/build-installer.mjs` 中明确说明使用 `next start`，因此需要完整 production `node_modules`：

```text
Uses `next start`, so the full production node_modules is shipped.
```

这决定了即使排除了 devDependencies，安装包仍然会包含大量生产依赖文件。

### 4.4 历史产物和多套打包方案容易互相干扰

当前 `dist` 目录中存在：

```text
dist/pkg
dist/Synthetix
dist/electron-main
```

但当前 Electron 配置期望的最终目录却是：

```text
dist/app
dist/electron
dist/installer
```

这说明本地工作区中存在历史构建产物，容易造成误判，甚至在旧脚本或手动操作时被误打包。

## 5. 是否需要换操作系统打包

不需要为了这个问题换成其他操作系统。

当前安装慢的根因不是 Windows 系统本身，而是：

1. payload 文件数量过多；
2. 构建产物不干净；
3. `.next/dev` 等开发缓存可能混入；
4. 完整 `node_modules` 被打包；
5. NSIS 对大量小文件解压和写入天然较慢。

但建议使用干净的 Windows 构建环境，例如：

- Windows 11 VM；
- GitHub Actions `windows-latest`；
- 专用 Windows 打包机。

使用干净环境的目的不是换 OS，而是避免本地开发目录污染：

- 不复用历史 `dist`；
- 不复用 `.next/dev`；
- 不带入本机缓存；
- 不带入开发依赖；
- 保证构建可复现。

## 6. 优化目标

优化后的 Windows 安装包应满足：

1. 安装阶段只复制已经准备好的运行时文件；
2. 安装阶段不下载依赖；
3. 安装阶段不下载模型；
4. 安装阶段不执行 Node/Python 构建；
5. 安装阶段不执行耗时迁移或生成任务；
6. 首次启动只做轻量初始化；
7. 最终 payload 不包含开发缓存、测试文件、历史构建产物和 devDependencies。

理想的安装包结构应接近：

```text
Synthetix.exe
resources/app/server.js
resources/app/.next/static
resources/app/public
resources/app/minimal runtime deps
resources/app/prisma
resources/app/workers
resources/app/runtime/python
resources/app/models/gte-multilingual-base
```

不应包含：

```text
root node_modules
node_modules/.pnpm
.next/dev
.next/cache
.next/trace
Playwright
Vitest
ESLint
TypeScript
Electron Builder
历史 dist 产物
测试、示例、文档、源码 map
```

## 7. 优化方案

### 7.1 P0：立即可做的清理和防护

这一阶段不改变整体架构，目标是防止垃圾文件进入安装包。

#### 7.1.1 每次正式打包前清理产物

正式打包前应删除：

```text
dist
.next
```

然后重新执行：

```text
next build
assemble dist/app
electron-builder
```

避免从长期开发目录中复用历史构建产物。

#### 7.1.2 增加 payload fail-fast 检查

在执行 electron-builder 前，应检查最终 `dist/app` 是否干净。

建议出现以下情况直接失败：

```text
dist/app/.next/dev 存在
dist/app/.next/cache 存在
dist/app/.next/trace 存在
dist/app/node_modules/.pnpm 存在
dist/app/node_modules/electron-builder 存在
dist/app/node_modules/playwright 存在
dist/app/node_modules/typescript 存在
dist/app/node_modules/vitest 存在
dist/app/node_modules/eslint 存在
```

这能避免悄悄打出一个被开发缓存污染的安装包。

#### 7.1.3 增加 payload 报告

每次打包前后应输出：

```text
dist/app total files
dist/app total size
dist/app/.next files/size
dist/app/node_modules files/size
dist/app/runtime files/size
dist/app/models files/size
top 20 directories by file count
top 20 directories by size
```

这样可以快速定位文件数和体积膨胀来源。

#### 7.1.4 调整 NSIS 压缩策略

当前 `electron-builder.yml` 中使用：

```yml
compression: maximum
```

这会减小安装包体积，但会明显拖慢打包和安装解压。对于当前诉求，建议评估：

```yml
compression: normal
```

甚至在重视安装速度时测试：

```yml
compression: store
```

取舍如下：

| 压缩方式 | 安装包体积 | 安装速度 | 适用场景 |
|---|---:|---:|---|
| maximum | 最小 | 最慢 | 网络分发成本极高 |
| normal | 中等 | 中等 | 推荐默认 |
| store | 最大 | 最快 | 极度重视安装体验 |

当前更应该优先保证安装不卡，而不是追求安装包最小。

#### 7.1.5 审查 dependencies

当前 `package.json` 中有一些可能不应进入生产依赖的包，例如：

```json
"@types/pg"
"shadcn"
"prisma"
```

建议确认：

- `@types/pg` 是否应移入 `devDependencies`；
- `shadcn` 是否只是开发期 CLI；
- `prisma` 是否必须在 packaged runtime 中存在，还是可以改为只保留生成后的 client 和必要 engine。

同时建议排查这些包为何进入生产打包目录：

```text
@modelcontextprotocol
fast-check
msw
zod-to-json-schema
shadcn
```

可以使用：

```text
pnpm why shadcn
pnpm why msw
pnpm why fast-check
pnpm why @modelcontextprotocol/*
pnpm why zod-to-json-schema
```

### 7.2 P1：迁移到 Next standalone，减少完整 node_modules

这是最推荐的中期优化方向。

当前问题的根本原因之一是使用：

```text
next start
```

因此必须打包完整 production `node_modules`。

更优方案是启用 Next standalone 输出：

```text
.next/standalone
.next/static
public
```

打包结构从：

```text
.next
node_modules
package.json
next.config.ts
pnpm-lock.yaml
pnpm-workspace.yaml
```

改为：

```text
server.js
.next/static
public
必要的 traced runtime deps
prisma
workers
runtime/python
models
```

#### 7.2.1 预期收益

迁移 standalone 后，可以显著减少：

- `node_modules` 文件数；
- pnpm hoisted/symlink 处理复杂度；
- 安装阶段写入的小文件数量；
- devDependency 混入风险；
- native binary 复制不完整的风险。

#### 7.2.2 Electron 启动方式需要调整

当前 `electron/main.ts` 启动 Next CLI：

```ts
spawn(nodeExe, [cli, "start", "-p", String(port), "-H", HOST])
```

当前 `electron/paths.ts` 中 `nextCliPath()` 指向：

```text
resources/app/node_modules/next/dist/bin/next
```

standalone 后应改为启动：

```text
node resources/app/server.js
```

也就是说，Electron 主进程不再依赖完整 Next CLI。

#### 7.2.3 需要重点验证的模块

本项目不能简单开启 standalone 就结束，需要重点验证：

1. Prisma client 是否被正确包含；
2. better-sqlite3 native binary 是否被正确包含；
3. Prisma schema 和 migrations 是否存在；
4. Python workers 是否仍能被定位；
5. `runtime/python` 是否可用；
6. 本地 ONNX 模型是否可被 `LOCAL_EMBED_MODEL_PATH` 正确定位；
7. `.next/static` 和 `public` 是否完整；
8. 文档上传、转换、分段、embedding、索引流程是否正常。

### 7.3 P2：进一步压缩 Python runtime 和资源文件

Python runtime 可能包含大量 site-packages、缓存、测试文件和编译相关文件。当前 `scripts/build-installer.mjs` 已经有一些裁剪逻辑，例如：

- 删除部分无用 Python 包；
- 删除 `Doc`、`include`、`libs`、`tcl`、`share`；
- 删除 wheel、`__pycache__`；
- 删除部分 torch 编译相关目录。

建议后续继续为 Python runtime 输出报告：

```text
runtime/python files
runtime/python size
site-packages top 20 by size
site-packages top 20 by file count
```

重点关注：

```text
torch
docling
onnxruntime
transformers
tokenizers
numpy
PIL
```

但 Python 裁剪风险较高，每删除一类包或文件后都必须验证文档转换、OCR、chunking 和 embedding 流程。

### 7.4 P3：高级安装体验优化

如果 standalone 和清理后安装仍然慢，可以进一步考虑：

1. 将 Python runtime 打成少量 archive；
2. 首次启动时解压到 userData，并显示明确进度；
3. 后续启动复用已解压 runtime；
4. 增加代码签名，减少 SmartScreen 和杀软干扰；
5. 做不同压缩级别的安装耗时 benchmark；
6. 对 HDD、SSD、Windows Defender 开关状态分别测试。

这类方案复杂度较高，不建议作为第一阶段。

## 8. 推荐实施路线

### 阶段 1：防污染与可观测性

目标：确保最终安装包不再被历史产物、开发缓存和 devDependencies 污染。

任务：

1. 打包前清理 `dist` 和 `.next`；
2. 增加 payload report；
3. 增加 fail-fast 检查；
4. 检查并清理明显 dev-only dependencies；
5. 将 NSIS 压缩从 `maximum` 评估改为 `normal`；
6. 使用干净 Windows 环境构建一次并记录安装耗时。

### 阶段 2：迁移 Next standalone

目标：减少完整 `node_modules`，降低安装文件数量。

任务：

1. 配置 Next standalone output；
2. 调整 `dist/app` 组装逻辑；
3. 调整 Electron 主进程启动 `server.js`；
4. 保留 Python、workers、models、prisma 显式资源复制；
5. 完整验证数据库、文档处理、embedding 和 UI 启动流程。

### 阶段 3：深度裁剪和体验优化

目标：进一步降低安装包体积和安装时间。

任务：

1. 深度裁剪 Python runtime；
2. 裁剪 node runtime 中无用文档、source map、测试和示例；
3. 评估资源 archive 化；
4. 加入代码签名；
5. 建立安装耗时 benchmark。

## 9. 推荐最终架构

推荐最终采用：

```text
Electron + Next standalone + 内置 Python runtime + 内置 ONNX 模型 + NSIS normal compression + 干净 Windows CI 打包
```

最终安装包应包含：

```text
Synthetix.exe
resources/app/server.js
resources/app/.next/static
resources/app/public
resources/app/minimal traced deps
resources/app/prisma
resources/app/workers
resources/app/runtime/python
resources/app/models/gte-multilingual-base
```

最终安装包不应包含：

```text
根 node_modules
node_modules/.pnpm
.next/dev
.next/cache
.next/trace
docs/e2e/prototype/scripts 源码目录
Playwright
Vitest
ESLint
TypeScript
Electron Builder
历史 dist 产物
```

## 10. 结论

当前安装卡顿不应该通过换操作系统解决。根因是安装包 payload 文件数量过多、构建产物不干净、完整 `node_modules` 和可能的 `.next/dev` 开发缓存进入打包流程，以及 NSIS 对大量小文件解压写入较慢。

短期应优先做防污染、payload 报告、fail-fast 检查和压缩策略调整。中期应迁移到 Next standalone，避免把完整 production `node_modules` 打进安装包。长期再考虑 Python runtime 深度裁剪、资源 archive 化、代码签名和安装耗时基准测试。

最重要的原则是：

> Windows 安装阶段只做复制已准备好的运行时文件，不下载、不构建、不生成、不迁移重活。安装包内只保留运行时绝对必要的文件。
