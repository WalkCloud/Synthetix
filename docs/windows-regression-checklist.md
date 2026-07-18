# Windows 回归验证清单

**目的**：在 Windows 机器上验证 `feat/macos-installer` 分支的 macOS 打包改动**没有破坏 Windows 打包路径**。

**核心结论（代码审查）**：本次只对 Windows 代码做了 1 处实质性改动（`build-installer.mjs` 的纯重构），且该改动是 helper 函数的字节级提取（已逐行对比确认）。但代码审查不能替代实际运行——请在 Windows 机器上跑完本清单。

---

## 0. 拉取分支 + 装依赖

```powershell
git clone https://github.com/WalkCloud/Synthetix.git
cd Synthetix
git checkout feat/macos-installer
npm install
```

**预期**：`npm install` 成功（这是 dev 依赖，macOS 专属脚本不会被加载）。

## 1. 确认重构没有引入语法/import 错误

```powershell
node --check scripts/build-installer.mjs
node --check scripts/build-electron.mjs
node --check scripts/lib/bundle-assembly.mjs
```

**预期**：三个命令都无输出（exit 0）。如果报语法错误，说明重构有问题。

## 2. 验证 `build-installer.mjs` 能正常加载（import 解析）

```powershell
node -e "import('./scripts/build-installer.mjs').then(()=>console.log('loads OK')).catch(e=>{console.error(e);process.exit(1)})"
```

**预期**：要么打印 `loads OK`，要么因为缺 iscc/runtime 而在业务逻辑里 `fail()`（但**不应该**报 `Cannot find module './lib/bundle-assembly.mjs'` 这种 import 错误）。

如果看到 import 解析错误，说明 `scripts/lib/bundle-assembly.mjs` 的路径或导出有问题——这是重构引入的回归。

## 3. 验证 `--assemble-only` 路径（不需要 iscc/runtime）

这是最关键的一步——它直接验证重构后 Windows 的 `dist/app` 组装逻辑是否字节一致。

```powershell
# 先构建 .next
npx prisma generate
npm run build

# 跑 --assemble-only（不需要 iscc，不需要 runtime，纯组装逻辑）
node scripts/build-installer.mjs --assemble-only --no-build
```

**预期**：
- 完成 Step 2（组装 dist/app）+ Step 2b（法律文件）
- 在 Step 3 前因为缺 runtime 而停（这是正常的，`--assemble-only` 本来就只组装）
- `dist/app/server.js`、`dist/app/.next/`、`dist/app/node_modules/`、`dist/app/prisma/`、`dist/app/workers/` 都存在

**如果失败**：记录报错。最可能的失败点是某个被 import 的 helper 函数行为和重构前不一致。

## 4.（可选）字节一致性对比

如果你之前在 Windows 上保留过重构前的 `dist/app`，可以对比：

```powershell
# 重构前的基线（如果你有）
# 重构后再跑一次 --assemble-only，对比 dist/app 的文件清单
# Windows 用 PowerShell:
Get-ChildItem -Recurse dist/app -File | Get-FileHash -Algorithm SHA256 | Sort-Object Hash | Select-Object -ExpandProperty Hash > after.txt
# 和 before.txt 对比
Compare-Object (Get-Content before.txt) (Get-Content after.txt)
```

**预期**：无差异（重构是字节级提取）。但这一步**不强制**——如果第 3 步成功且第 5 步完整构建成功，字节一致性就有保障。

## 5. 完整 Windows 构建（需要 iscc + runtime）

这是最终验证——完整的 Windows 安装包能否正常产出。

**前置条件**（Windows 机器需要）：
- Inno Setup 6 安装（`winget install JRSoftware.InnoSetup`）
- `dist/runtime/{node.exe, python/}` 或 `dist/.runtime-cache/`（operator 预置的完整 CPython 环境，含 onnxruntime/transformers/docling 等——**和之前 Windows 构建用的一样**）

```powershell
npm run electron:build
```

**预期**：
- `generate:meta` 成功
- `build-electron.mjs` 调 `build-installer.mjs`（全流程）
- 产出 `dist/electron/Synthetix Setup 1.0.3.exe`（或类似 NSIS 安装包）

**如果失败**：记录报错。重点看是否是 helper 函数（copyDir/copyFile/rmrf 等）行为异常。

## 6. 验证 mac 块不影响 Windows 配置

```powershell
# 确认 electron-builder 还能读 win/nsis 配置
npx electron-builder --config electron-builder.yml --help
```

**预期**：无错误。`mac:`/`dmg:` 块对 Windows 构建是惰性的（electron-builder 只读 `--win` 相关配置）。

---

## 如果发现问题

请把以下信息发给我：
1. 具体报错（完整 stderr）
2. 是哪一步失败的（第几步）
3. `git log --oneline -1` 的输出（确认在 `eba11a3` 提交上）

## 预期结论

基于代码审查，Windows 路径**应该零回归**。本次改动：
- `build-installer.mjs`：纯 helper 提取（9 个函数字节一致，已逐行对比）+ `findIscc` 在 `--assemble-only` 时跳过（Windows 正常构建时 `ASSEMBLE_ONLY=false`，走原逻辑）
- `electron-builder.yml`：只加 `mac:`/`dmg:` 块，`win:`/`nsis:` 一个字符没动
- `package.json`：只加 3 个 `:mac` 脚本，Windows 脚本不变
- 其他文件（`build-installer-mac.mjs` 等）是 macOS 专属，Windows 不加载
