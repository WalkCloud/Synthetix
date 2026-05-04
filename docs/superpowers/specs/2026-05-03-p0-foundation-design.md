# Synthetix P0 基础框架设计文档

**日期**: 2026-05-03
**阶段**: P0 — 基础框架
**状态**: 已确认

---

## 1. 概述

P0 是 Synthetix 智能文档编写工具的基础框架阶段，为后续所有功能模块（文档处理、RAG检索、思路整理、文档编写等）提供技术基础设施。

### 1.1 P0 范围

| 模块 | 功能 | 对应需求 |
|------|------|----------|
| 项目初始化 | Next.js 15 + Tailwind + shadcn/ui | 技术架构 |
| 本地认证 | JWT 认证、首次启动引导 | F7 |
| 模型管理 | LLM 提供商配置、模型能力管理 | F6 |
| 仪表盘 | 首页统计、快捷入口 | F0 (基础版) |
| 任务队列基础 | 进程内异步任务管理 | 通用 |
| 用户设置 | 个人信息、密码修改 | F7 |

### 1.2 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 架构方案 | 经典 Next.js App Router 全栈 | 符合需求文档选型，离线单进程友好 |
| 数据库 | SQLite (Prisma ORM) | 轻量无外部依赖，离线 MVP 优先 |
| 认证 | 自建 JWT (access + refresh) | 完全可控，无外部 BaaS 依赖 |
| 任务队列 | 进程内队列 (AsyncGenerator) | 无需 Redis，单机部署足够 |
| UI 组件 | shadcn/ui + Tailwind CSS | 高度可定制，精确还原原型设计 |
| LLM 适配 | OpenAI 兼容接口统一抽象 | Ollama/OpenAI/DeepSeek 等均兼容 |
| 文档处理 | TypeScript 全栈 + Python 子进程 | 统一技术栈，MarkItDown 通过子进程调用 |

---

## 2. 项目目录结构

```
synthetix/
├── prisma/
│   ├── schema.prisma          # 数据模型定义
│   ├── migrations/            # 数据库迁移
│   └── seed.ts                # 种子数据
├── public/
│   └── images/                # 静态资源
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── (auth)/            # 认证路由组（无 sidebar 布局）
│   │   │   ├── login/         # 登录页
│   │   │   └── setup/         # 首次启动引导
│   │   ├── (dashboard)/       # 主应用路由组（sidebar 布局）
│   │   │   ├── layout.tsx     # Sidebar + Header 布局
│   │   │   ├── page.tsx       # F0 仪表盘首页
│   │   │   ├── documents/     # F1 文档初始化 + F2 文档库（P1 实现）
│   │   │   ├── brainstorm/    # F3 思路整理（P3 实现）
│   │   │   ├── writing/       # F4 文档编写（P4 实现）
│   │   │   ├── topology/      # F5 文档拓扑（P5 实现）
│   │   │   ├── models/        # F6 模型管理
│   │   │   └── settings/      # F7 用户/系统设置
│   │   ├── api/
│   │   │   └── v1/            # REST API 路由
│   │   │       ├── auth/      # 认证相关
│   │   │       ├── users/     # 用户管理
│   │   │       ├── models/    # 模型管理
│   │   │       ├── tasks/     # 异步任务
│   │   │       └── system/    # 系统状态
│   │   ├── layout.tsx         # 根布局
│   │   └── globals.css        # Tailwind + 设计令牌
│   ├── components/
│   │   ├── ui/                # shadcn/ui 基础组件
│   │   ├── layout/            # 布局组件 (Sidebar, Header)
│   │   ├── auth/              # 认证相关组件
│   │   ├── models/            # 模型管理组件
│   │   └── shared/            # 共享业务组件
│   ├── lib/
│   │   ├── auth/              # JWT 认证逻辑
│   │   │   ├── jwt.ts         # JWT 签发/验证
│   │   │   ├── middleware.ts   # 认证中间件
│   │   │   └── password.ts    # bcrypt 密码处理
│   │   ├── db.ts              # Prisma 客户端单例
│   │   ├── queue/             # 进程内任务队列
│   │   │   ├── types.ts       # 任务类型定义
│   │   │   ├── queue.ts       # 队列核心逻辑
│   │   │   └── workers/       # Worker 实现
│   │   ├── llm/               # LLM 适配层
│   │   │   ├── types.ts       # LLM 接口定义
│   │   │   ├── adapter.ts     # OpenAICompatibleAdapter
│   │   │   └── factory.ts     # 适配器工厂
│   │   ├── crypto.ts          # API Key 加解密
│   │   └── utils.ts           # 工具函数
│   ├── hooks/                 # 自定义 React Hooks
│   └── types/                 # TypeScript 类型定义
├── workers/
│   └── python/                # Python Worker（MarkItDown 等）
│       ├── requirements.txt
│       ├── convert.py
│       └── ...
├── .env.local
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 3. 数据库 Schema

### 3.1 User

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| username | String (unique) | 用户名 |
| email | String (unique, nullable) | 邮箱 |
| password_hash | String | bcrypt 加密密码 |
| display_name | String | 显示名称 |
| avatar_url | String (nullable) | 头像 URL |
| role | Enum (admin, user) | 角色 |
| is_first_login | Boolean | 是否首次登录 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |

### 3.2 ModelProvider

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| user_id | String (FK → User) | 所属用户 |
| name | String | 提供商名称 |
| provider_type | Enum (ollama, openai_compatible, anthropic, custom) | 类型 |
| api_base_url | String | API 地址 |
| api_key | String (nullable) | AES-256 加密的 API Key |
| is_active | Boolean | 是否启用 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |

### 3.3 ModelConfig

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| provider_id | String (FK → ModelProvider) | 所属提供商 |
| model_id | String | 模型标识（如 qwen2.5:7b） |
| model_name | String | 显示名称 |
| capabilities | String (JSON) | 能力标签数组 |
| context_window | Int | 上下文窗口大小 |
| max_output_tokens | Int (nullable) | 最大输出 token |
| supports_streaming | Boolean | 是否支持流式 |
| input_price | Float (nullable) | 输入 token 单价 |
| output_price | Float (nullable) | 输出 token 单价 |
| local_or_cloud | Enum (local, cloud) | 本地/云端 |
| is_default_for | String (nullable) | 默认用途（如 writing） |
| created_at | DateTime | 创建时间 |

### 3.4 AsyncTask

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| user_id | String (FK → User) | 所属用户 |
| type | Enum | 任务类型 |
| status | Enum (pending, running, completed, failed, cancelled) | 状态 |
| progress | Int (default 0) | 进度百分比 |
| input_data | String (JSON, nullable) | 输入参数 |
| result_data | String (JSON, nullable) | 结果数据 |
| error_message | String (nullable) | 错误信息 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |

AsyncTask.type 枚举值：`document_upload`, `document_convert`, `rag_index`, `chapter_generate`, `chapter_summarize`, `outline_generate`

### 3.5 TokenUsage

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| user_id | String (FK → User) | 所属用户 |
| model_config_id | String (FK → ModelConfig, nullable) | 使用的模型 |
| module | String | 功能模块（chat/writing/embedding 等） |
| input_tokens | Int | 输入 token 数 |
| output_tokens | Int | 输出 token 数 |
| cost_estimate | Float (nullable) | 费用估算 |
| reference_id | String (nullable) | 关联文档/章节 ID |
| created_at | DateTime | 创建时间 |

### 3.6 实体关系

```
User 1──N ModelProvider
User 1──N AsyncTask
User 1──N TokenUsage

ModelProvider 1──N ModelConfig
ModelConfig 1──N TokenUsage
```

---

## 4. 认证系统

### 4.1 认证流程

**首次启动**：Middleware 检测数据库中是否存在 User 记录，若不存在则重定向到 `/setup` → 创建管理员账号 → 自动登录 → 跳转仪表盘

**登录**：
1. `POST /api/v1/auth/login` 提交 username + password
2. bcrypt 验证密码
3. 签发 JWT：access_token (15min) + refresh_token (7d)
4. 存入 HttpOnly Cookie，防 XSS 攻击

**请求守卫 (Next.js Middleware)**：
- 每个请求检查 access_token 有效性
- 有效：注入 user_id 到请求 headers，放行
- 过期：自动用 refresh_token 换发新 access_token
- 无效：302 重定向到 /login

**Token 刷新**：
- `POST /api/v1/auth/refresh` 验证 refresh_token → 签发新 access_token
- 前端无感刷新，用户不中断操作

### 4.2 安全措施

| 措施 | 说明 |
|------|------|
| 密码存储 | bcrypt，salt rounds = 12 |
| Token 存储 | HttpOnly + Secure + SameSite=Strict Cookie |
| API Key 加密 | AES-256-GCM，密钥从环境变量读取 |
| CSRF 防护 | SameSite Cookie + 自定义 Header 校验 |
| 输入验证 | Zod schema 验证所有 API 输入 |

---

## 5. API 路由

### 5.1 认证 Auth

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | /api/v1/auth/login | 用户登录 |
| POST | /api/v1/auth/logout | 用户登出 |
| POST | /api/v1/auth/refresh | 刷新 Token |
| POST | /api/v1/auth/setup | 首次启动创建账号 |

### 5.2 用户 Users

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | /api/v1/users/profile | 查询个人信息 |
| PUT | /api/v1/users/profile | 更新个人信息 |
| PUT | /api/v1/users/password | 修改密码 |

### 5.3 模型 Models

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | /api/v1/models/providers | 查询模型提供商列表 |
| POST | /api/v1/models/providers | 添加模型提供商 |
| GET | /api/v1/models/providers/:id | 查询提供商详情 |
| PUT | /api/v1/models/providers/:id | 更新提供商配置 |
| DELETE | /api/v1/models/providers/:id | 删除提供商 |
| POST | /api/v1/models/providers/:id/test | 测试模型连接 |
| GET | /api/v1/models/usage | Token 消耗统计 |

### 5.4 任务 Tasks

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | /api/v1/tasks/:id | 查询任务状态 |
| POST | /api/v1/tasks/:id/cancel | 取消任务 |

### 5.5 系统 System

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | /api/v1/system/status | 系统状态（初始化检查、服务可用性） |

---

## 6. 任务队列

### 6.1 核心接口

```typescript
interface TaskQueue {
  submit(type: TaskType, payload: TaskPayload): Promise<string>
  getStatus(taskId: string): Promise<TaskStatus>
  cancel(taskId: string): Promise<void>
  onProgress(taskId: string, callback: (p: number) => void): void
}
```

### 6.2 工作流程

1. API Route 调用 `queue.submit(type, payload)` 创建任务
2. 返回 202 + taskId 给前端
3. Worker 从队列取出任务执行
4. 通过 AsyncTask 表更新进度和状态
5. 前端轮询 `GET /api/v1/tasks/:id` 获取状态（P0 用轮询，后续可升级 SSE）

### 6.3 并发控制

| 参数 | 默认值 | 说明 |
|------|--------|------|
| maxConcurrency | 3 | 最大同时执行任务数 |
| timeout | 10 min | 任务超时自动标记 failed |
| retryLimit | 2 | 失败任务最大重试次数 |

---

## 7. LLM 适配层

### 7.1 统一接口

```typescript
interface LLMProvider {
  chat(params: ChatParams): AsyncGenerator<ChatChunk>
  embed(texts: string[]): Promise<number[][]>
  testConnection(): Promise<boolean>
  getModels(): Promise<ModelInfo[]>
}
```

### 7.2 适配器实现

`OpenAICompatibleAdapter` — 统一使用 `/v1/chat/completions` 和 `/v1/embeddings` 接口格式，兼容：
- Ollama（本地）
- OpenAI / DeepSeek / 通义千问（云端）
- 任何 OpenAI 兼容 API

### 7.3 调用流程

1. 用户选择模型 → 查询 ModelConfig → 获取关联 ModelProvider
2. 工厂函数 `createLLMProvider(provider)` 创建适配器实例
3. 调用 `adapter.chat()` 流式返回内容
4. 记录 TokenUsage（input_tokens, output_tokens, cost_estimate）

---

## 8. UI 设计系统

### 8.1 设计令牌映射

| 原型 CSS 变量 | 值 | Tailwind 配置 |
|---------------|-----|---------------|
| --color-primary | #4361EE | primary (自定义色) |
| --color-cta | #FF6B3D | accent (CTA 色) |
| --color-bg | #F7F6F3 | bg-base |
| --sidebar-width | 260px | w-[260px] |
| --header-height | 64px | h-16 |
| --radius-md | 12px | rounded-xl |
| Figtree | 正文 | font-sans |
| Urbanist | 标题 | font-display |

### 8.2 P0 页面清单

| 路由 | 页面组件 | 说明 |
|------|----------|------|
| /setup | SetupWizard | 首次启动引导（步骤条） |
| /login | LoginPage | 登录页（复刻原型 index.html） |
| / | DashboardPage | 仪表盘（统计卡片 + 快捷入口） |
| /models | ModelsPage | 模型管理（Tabs: 提供商/能力/用量/日志） |
| /models/new | AddProviderDialog | 添加/编辑模型提供商 |
| /settings | SettingsPage | 用户设置（个人信息 + 密码） |

### 8.3 布局组件

| 组件 | 说明 |
|------|------|
| AppLayout | Sidebar + Header + Main 组合 |
| Sidebar | 导航侧边栏（260px，支持折叠到 72px） |
| Header | 顶部导航（搜索 + 通知 + 用户菜单） |

### 8.4 共享业务组件

| 组件 | 说明 |
|------|------|
| StatsCard | 统计卡片（图标 + 数值 + 变化趋势） |
| DataTable | 数据表格（排序 + 分页 + 筛选） |
| ConfirmDialog | 确认对话框 |
| EmptyState | 空状态占位 |
| LoadingState | 加载状态骨架屏 |

### 8.5 shadcn/ui 组件（按需安装）

Button, Input, Label, Card, Tabs, Dialog, DropdownMenu, Avatar, Badge, Separator, Select, Switch, Toast, Tooltip, Skeleton

---

## 9. 环境变量

```env
# 数据库
DATABASE_URL="file:./dev.db"

# JWT
JWT_SECRET="your-jwt-secret-min-32-chars"
JWT_ACCESS_EXPIRES="15m"
JWT_REFRESH_EXPIRES="7d"

# API Key 加密
ENCRYPTION_KEY="your-encryption-key-32-chars"

# 应用
NEXT_PUBLIC_APP_NAME="Synthetix"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```
