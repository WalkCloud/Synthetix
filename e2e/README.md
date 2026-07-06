# Synthetix 浏览器端 E2E 测试

> 测试方案：`docs/test-plan-browser-2026-06-29.md`

## 运行环境

- dev server 运行在 `http://localhost:3000`（`npm run dev`）
- 登录账号：`admin / Admin@123`（真实环境，非 mock）
- Playwright 1.59.1 + chromium 浏览器（与项目 PDF 导出共用）

## 运行命令

```bash
# 冒烟套件（约 2.5 分钟，不跑真实文档处理）
pnpm e2e:smoke

# 完整套件（1.5–2.5 小时，真实 LLM + 文档处理 + 删除级联）
pnpm e2e:full

# 全部
pnpm e2e

# 单个文件
npx playwright test auth.spec.ts

# 查看报告
pnpm e2e:report
```

## 测试文档

| 文档 | 大小 | 用于模式 |
|---|---|---|
| `Z:\VM ShareFolder\test\烟台银行容器平台投标技术方案_260427.docx` | 90 MB | 仅 full（完整分析） |
| `Z:\VM ShareFolder\test\河南农商银行容器云平台建设方案参考-20260305.docx` | 17 MB | standard / graph / wiki |

## 结构

```
e2e/
├─ global-setup.ts              # 登录落盘 storageState
├─ global-teardown.ts           # 清理 [E2E] 命名资源
├─ helpers/
│  ├─ api.ts                    # 鉴权 fetch 封装
│  ├─ constants.ts              # 文档路径、模式定义、超时
│  ├─ task-poller.ts            # 异步任务轮询
│  ├─ documents.ts              # 上传/处理/流水线
│  ├─ delete-verify.ts          # 删除残留独立验证
│  ├─ models.ts                 # 模型读取（只读）
│  └─ selectors.ts              # UI 选择器
├─ auth.spec.ts                 # 模块1 鉴权
├─ navigation.spec.ts           # 模块2 导航
├─ dashboard.spec.ts            # 模块3 仪表盘
├─ library.spec.ts              # 模块4 文档库/检索
├─ models.spec.ts               # 模块11 模型管理（只读）
├─ settings.spec.ts             # 模块12 设置
├─ non-functional.spec.ts       # 模块14 非功能
├─ processing-modes-ui.spec.ts  # 5A-A组 模式UI（冒烟）
├─ processing-modes-pipeline.spec.ts  # 5A-B/C组 四模式流水线+效率（@full）
├─ delete-cascade-boundary.spec.ts    # 5B 边界删除（冒烟）
└─ delete-cascade.spec.ts       # 5B 删除级联（@full）
```

## 策略要点

- **真实 LLM**：不 mock，断言结构/状态/可见性而非具体文本
- **数据隔离**：测试资源带 `[E2E]` 前缀，teardown 仅清理前缀数据
- **配置不动**：模型管理只读，绝不改/删用户已配置 provider
- **删除验证**：绕过 API 空校验，走 entities/graph/wiki 独立复查
- **效率数据**：`e2e/.report/efficiency.json` 记录各模式真实耗时
