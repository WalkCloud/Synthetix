# P0 基础框架实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Synthetix 的基础技术框架 — Next.js 15 全栈应用，包含本地认证、模型管理、仪表盘和任务队列基础设施。

**Architecture:** 经典 Next.js 15 App Router 全栈架构。API Routes 处理业务接口，Server Actions 处理表单操作，Middleware 做 JWT 认证守卫。SQLite + Prisma ORM 存储数据。进程内队列管理异步任务。LLM 通过 OpenAI 兼容接口统一抽象。

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Prisma, SQLite, JWT (jose), bcryptjs, Zod

**Spec:** `docs/superpowers/specs/2026-05-03-p0-foundation-design.md`

---

## 文件结构总览

```
src/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (auth)/setup/page.tsx
│   ├── (auth)/layout.tsx
│   ├── (dashboard)/layout.tsx
│   ├── (dashboard)/page.tsx              # Dashboard
│   ├── (dashboard)/models/page.tsx
│   ├── (dashboard)/settings/page.tsx
│   ├── api/v1/auth/login/route.ts
│   ├── api/v1/auth/logout/route.ts
│   ├── api/v1/auth/refresh/route.ts
│   ├── api/v1/auth/setup/route.ts
│   ├── api/v1/users/profile/route.ts
│   ├── api/v1/users/password/route.ts
│   ├── api/v1/models/providers/route.ts
│   ├── api/v1/models/providers/[id]/route.ts
│   ├── api/v1/models/providers/[id]/test/route.ts
│   ├── api/v1/models/usage/route.ts
│   ├── api/v1/tasks/[id]/route.ts
│   ├── api/v1/system/status/route.ts
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                               # shadcn/ui (按需安装)
│   ├── layout/sidebar.tsx
│   ├── layout/header.tsx
│   ├── auth/login-form.tsx
│   ├── auth/setup-wizard.tsx
│   ├── models/provider-form.tsx
│   ├── models/models-tabs.tsx
│   ├── shared/stats-card.tsx
│   ├── shared/confirm-dialog.tsx
│   ├── shared/empty-state.tsx
│   └── shared/loading-state.tsx
├── lib/
│   ├── auth/jwt.ts
│   ├── auth/password.ts
│   ├── auth/session.ts
│   ├── db.ts
│   ├── crypto.ts
│   ├── queue/types.ts
│   ├── queue/queue.ts
│   ├── llm/types.ts
│   ├── llm/adapter.ts
│   ├── llm/factory.ts
│   └── utils.ts
├── hooks/
│   ├── use-auth.ts
│   └── use-tasks.ts
├── types/
│   ├── auth.ts
│   ├── models.ts
│   └── api.ts
├── middleware.ts
prisma/
├── schema.prisma
└── seed.ts
```

---

## Task 1: 项目脚手架 + 设计系统

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`
- Create: `src/app/layout.tsx`, `src/app/globals.css`
- Create: `.env.local`, `.env.example`
- Create: `prisma/schema.prisma`

- [ ] **Step 1: 初始化 Next.js 项目**

```bash
cd "/Users/kevin/Project folder/project09"
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
```

注意：如果提示目录非空，选择覆盖冲突文件。保留 `docs/`, `prototype/`, `CLAUDE.md`。

- [ ] **Step 2: 安装核心依赖**

```bash
pnpm add prisma @prisma/client jose bcryptjs zod uuid
pnpm add -D @types/bcryptjs @types/uuid
```

- [ ] **Step 3: 初始化 Prisma + SQLite**

```bash
pnpm prisma init --datasource-provider sqlite
```

- [ ] **Step 4: 配置 Tailwind 设计令牌**

在 `tailwind.config.ts` 中添加自定义色和字体配置，映射原型的设计系统：

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#4361EE",
          light: "#6B83F2",
          dark: "#3651D4",
          50: "#F5F6FE",
          100: "#EEF0FD",
          200: "#DDE2FC",
        },
        accent: {
          DEFAULT: "#FF6B3D",
          light: "#FF8A63",
          dark: "#E85528",
        },
        base: "#F7F6F3",
        "base-white": "#FFFFFF",
        "base-gray": "#EEEEE9",
      },
      fontFamily: {
        sans: ["Figtree", "-apple-system", "BlinkMacSystemFont", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        display: ["Urbanist", "-apple-system", "PingFang SC", "Microsoft YaHei", "sans-serif"],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "22px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 5: 初始化 shadcn/ui**

```bash
pnpm dlx shadcn@latest init -d
```

选择：New York style, Zinc base color, CSS variables: yes。

- [ ] **Step 6: 安装常用 shadcn/ui 组件**

```bash
pnpm dlx shadcn@latest add button input label card tabs dialog dropdown-menu avatar badge separator select switch toast tooltip skeleton
```

- [ ] **Step 7: 配置 globals.css 设计令牌**

在 `src/app/globals.css` 中设置 CSS 变量，与原型对齐：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 40 20% 96.5%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 229 83% 59%;
    --primary-foreground: 0 0% 100%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 20 100% 62%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 229 83% 59%;
    --radius: 0.75rem;
  }
}
```

- [ ] **Step 8: 创建环境变量文件**

创建 `.env.example`：
```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="change-me-to-a-random-32-char-string"
JWT_ACCESS_EXPIRES="15m"
JWT_REFRESH_EXPIRES="7d"
ENCRYPTION_KEY="change-me-to-a-random-32-char-string"
NEXT_PUBLIC_APP_NAME="Synthetix"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

复制到 `.env.local` 并设置实际值。

- [ ] **Step 9: 更新根布局**

修改 `src/app/layout.tsx`：

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synthetix - AI-Powered Document Authoring",
  description: "Write, organize, and publish professional documents with intelligent assistance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="font-sans antialiased bg-base text-foreground">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 10: 验证项目可运行**

```bash
pnpm dev
```

Expected: 浏览器打开 http://localhost:3000 看到 Next.js 默认页面。

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js project with design system and dependencies"
```

---

## Task 2: 数据库 Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/db.ts`
- Create: `prisma/seed.ts`

- [ ] **Step 1: 编写 Prisma Schema**

替换 `prisma/schema.prisma` 全部内容：

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id            String   @id @default(uuid())
  username      String   @unique
  email         String?  @unique
  passwordHash  String   @map("password_hash")
  displayName   String   @map("display_name") @default("")
  avatarUrl     String?  @map("avatar_url")
  role          String   @default("admin") // admin | user
  isFirstLogin  Boolean  @default(true) @map("is_first_login")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  providers  ModelProvider[]
  tasks      AsyncTask[]
  tokenUsage TokenUsage[]

  @@map("users")
}

model ModelProvider {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  name         String
  providerType String   @map("provider_type") // ollama | openai_compatible | anthropic | custom
  apiBaseUrl   String   @map("api_base_url")
  apiKey       String?  @map("api_key") // AES-256 encrypted
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  models   ModelConfig[]
  usage    TokenUsage[]

  @@map("model_providers")
}

model ModelConfig {
  id                String   @id @default(uuid())
  providerId        String   @map("provider_id")
  modelId           String   @map("model_id") // e.g. "qwen2.5:7b"
  modelName         String   @map("model_name")
  capabilities      String   @default("[]") // JSON array
  contextWindow     Int      @map("context_window") @default(4096)
  maxOutputTokens   Int?     @map("max_output_tokens")
  supportsStreaming  Boolean  @default(true) @map("supports_streaming")
  inputPrice        Float?   @map("input_price")
  outputPrice       Float?   @map("output_price")
  localOrCloud      String   @default("local") @map("local_or_cloud") // local | cloud
  isDefaultFor      String?  @map("is_default_for") // e.g. "writing"
  createdAt         DateTime @default(now()) @map("created_at")

  provider ModelProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  usage    TokenUsage[]

  @@map("model_configs")
}

model AsyncTask {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  type         String   // document_upload | document_convert | rag_index | chapter_generate | ...
  status       String   @default("pending") // pending | running | completed | failed | cancelled
  progress     Int      @default(0)
  inputData    String?  @map("input_data") // JSON
  resultData   String?  @map("result_data") // JSON
  errorMessage String?  @map("error_message")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("async_tasks")
}

model TokenUsage {
  id            String   @id @default(uuid())
  userId        String   @map("user_id")
  modelConfigId String?  @map("model_config_id")
  module        String   // chat | writing | embedding | ...
  inputTokens   Int      @map("input_tokens")
  outputTokens  Int      @map("output_tokens")
  costEstimate  Float?   @map("cost_estimate")
  referenceId   String?  @map("reference_id")
  createdAt     DateTime @default(now()) @map("created_at")

  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  modelConfig ModelConfig?  @relation(fields: [modelConfigId], references: [id], onDelete: SetNull)

  @@map("token_usage")
}
```

- [ ] **Step 2: 运行数据库迁移**

```bash
pnpm prisma migrate dev --name init
```

Expected: 生成 `prisma/migrations/` 目录，创建 `prisma/dev.db` 文件。

- [ ] **Step 3: 创建 Prisma 客户端单例**

创建 `src/lib/db.ts`：

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

- [ ] **Step 4: 创建 TypeScript 类型**

创建 `src/types/auth.ts`：

```typescript
export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: string;
}

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
}
```

创建 `src/types/models.ts`：

```typescript
export type ProviderType = "ollama" | "openai_compatible" | "anthropic" | "custom";
export type LocalOrCloud = "local" | "cloud";

export interface ModelCapability {
  capability: string;
  label: string;
}

export const MODEL_CAPABILITIES: ModelCapability[] = [
  { capability: "chat", label: "对话" },
  { capability: "writing", label: "写作" },
  { capability: "embedding", label: "向量化" },
  { capability: "rerank", label: "重排序" },
  { capability: "vision", label: "视觉理解" },
  { capability: "image_generation", label: "文生图" },
  { capability: "summarization", label: "摘要" },
  { capability: "splitting", label: "文档拆分" },
];

export interface ProviderFormData {
  name: string;
  providerType: ProviderType;
  apiBaseUrl: string;
  apiKey?: string;
  models: ModelConfigFormData[];
}

export interface ModelConfigFormData {
  modelId: string;
  modelName: string;
  capabilities: string[];
  contextWindow: number;
  maxOutputTokens?: number;
  supportsStreaming: boolean;
  inputPrice?: number;
  outputPrice?: number;
  localOrCloud: LocalOrCloud;
  isDefaultFor?: string;
}
```

创建 `src/types/api.ts`：

```typescript
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema with SQLite and type definitions"
```

---

## Task 3: 认证工具库

**Files:**
- Create: `src/lib/auth/password.ts`
- Create: `src/lib/auth/jwt.ts`
- Create: `src/lib/crypto.ts`
- Create: `src/__tests__/auth/password.test.ts`
- Create: `src/__tests__/auth/jwt.test.ts`
- Create: `src/__tests__/crypto.test.ts`

- [ ] **Step 1: 安装测试依赖**

```bash
pnpm add -D vitest @vitejs/plugin-react
```

创建 `vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

在 `package.json` 添加 scripts：
```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

- [ ] **Step 2: 编写密码工具测试**

创建 `src/__tests__/auth/password.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password utils", () => {
  it("should hash a password", async () => {
    const hash = await hashPassword("test123");
    expect(hash).not.toBe("test123");
    expect(hash.startsWith("$2b$")).toBe(true);
  });

  it("should verify correct password", async () => {
    const hash = await hashPassword("test123");
    const result = await verifyPassword("test123", hash);
    expect(result).toBe(true);
  });

  it("should reject wrong password", async () => {
    const hash = await hashPassword("test123");
    const result = await verifyPassword("wrong", hash);
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 3: 实现密码工具**

创建 `src/lib/auth/password.ts`：

```typescript
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 4: 运行密码测试**

```bash
pnpm test:run src/__tests__/auth/password.test.ts
```

Expected: 3 tests PASS。

- [ ] **Step 5: 编写 JWT 工具测试**

创建 `src/__tests__/auth/jwt.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { signAccessToken, signRefreshToken, verifyToken } from "@/lib/auth/jwt";

describe("JWT utils", () => {
  it("should sign and verify access token", async () => {
    const payload = { userId: "user-1", username: "admin", role: "admin" };
    const token = await signAccessToken(payload);
    const decoded = await verifyToken(token);
    expect(decoded.userId).toBe("user-1");
    expect(decoded.username).toBe("admin");
  });

  it("should sign and verify refresh token", async () => {
    const payload = { userId: "user-1", username: "admin", role: "admin" };
    const token = await signRefreshToken(payload);
    const decoded = await verifyToken(token);
    expect(decoded.userId).toBe("user-1");
  });

  it("should reject invalid token", async () => {
    await expect(verifyToken("invalid-token")).rejects.toThrow();
  });
});
```

- [ ] **Step 6: 实现 JWT 工具**

创建 `src/lib/auth/jwt.ts`：

```typescript
import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "@/types/auth";

const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default-secret-change-me");
const accessExpires = process.env.JWT_ACCESS_EXPIRES || "15m";
const refreshExpires = process.env.JWT_REFRESH_EXPIRES || "7d";

export async function signAccessToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(accessExpires)
    .setIssuedAt()
    .sign(secret);
}

export async function signRefreshToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(refreshExpires)
    .setIssuedAt()
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JWTPayload;
}
```

- [ ] **Step 7: 运行 JWT 测试**

```bash
pnpm test:run src/__tests__/auth/jwt.test.ts
```

Expected: 3 tests PASS。

- [ ] **Step 8: 编写加密工具测试**

创建 `src/__tests__/crypto.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

describe("crypto utils", () => {
  it("should encrypt and decrypt a value", () => {
    const original = "sk-test-api-key-12345";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("should produce different ciphertext each time", () => {
    const encrypted1 = encrypt("same-value");
    const encrypted2 = encrypt("same-value");
    expect(encrypted1).not.toBe(encrypted2);
  });
});
```

- [ ] **Step 9: 实现加密工具**

创建 `src/lib/crypto.ts`：

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || "default-encryption-key-change-me";
  return scryptSync(secret, "synthetix-salt", KEY_LENGTH);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const data = Buffer.from(ciphertext, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
```

- [ ] **Step 10: 运行加密测试**

```bash
pnpm test:run src/__tests__/crypto.test.ts
```

Expected: 2 tests PASS。

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add auth utilities (password, JWT, crypto) with tests"
```

---

## Task 4: 认证中间件 + API 路由

**Files:**
- Create: `src/middleware.ts`
- Create: `src/lib/auth/session.ts`
- Create: `src/app/api/v1/auth/login/route.ts`
- Create: `src/app/api/v1/auth/logout/route.ts`
- Create: `src/app/api/v1/auth/refresh/route.ts`
- Create: `src/app/api/v1/auth/setup/route.ts`
- Create: `src/app/api/v1/system/status/route.ts`

- [ ] **Step 1: 创建 Session 工具**

创建 `src/lib/auth/session.ts`：

```typescript
import { cookies } from "next/headers";
import { verifyToken, signAccessToken, signRefreshToken } from "./jwt";
import type { AuthUser, JWTPayload } from "@/types/auth";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_KEY, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 15, // 15 min
  });
  cookieStore.set(REFRESH_TOKEN_KEY, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function clearAuthCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_KEY);
  cookieStore.delete(REFRESH_TOKEN_KEY);
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_KEY)?.value;
  if (!accessToken) return null;

  try {
    const payload = await verifyToken(accessToken);
    return {
      id: payload.userId,
      username: payload.username,
      email: null,
      displayName: "",
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_KEY)?.value;
  if (!refreshToken) return null;

  try {
    const payload = await verifyToken(refreshToken);
    const newAccessToken = await signAccessToken({
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    });
    cookieStore.set(ACCESS_TOKEN_KEY, newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 15,
    });
    return newAccessToken;
  } catch {
    return null;
  }
}

export function payloadToAuthUser(payload: JWTPayload): AuthUser {
  return {
    id: payload.userId,
    username: payload.username,
    email: null,
    displayName: "",
    role: payload.role,
  };
}
```

- [ ] **Step 2: 创建 Next.js 中间件**

创建 `src/middleware.ts`：

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const publicPaths = ["/login", "/setup", "/api/v1/auth", "/api/v1/system"];

function isPublicPath(pathname: string): boolean {
  return publicPaths.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) {
    // If user is logged in and tries to access login, redirect to dashboard
    if (pathname === "/login") {
      const accessToken = request.cookies.get("access_token")?.value;
      if (accessToken) {
        try {
          const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default-secret-change-me");
          await jwtVerify(accessToken, secret);
          return NextResponse.redirect(new URL("/", request.url));
        } catch {
          // Token invalid, continue to login
        }
      }
    }
    return NextResponse.next();
  }

  // Check authentication for protected paths
  const accessToken = request.cookies.get("access_token")?.value;

  if (accessToken) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default-secret-change-me");
      await jwtVerify(accessToken, secret);
      return NextResponse.next();
    } catch {
      // Access token expired, try refresh
    }
  }

  // Try refresh token — sign new access token directly in middleware to avoid circular API call
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (refreshToken) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default-secret-change-me");
      const { payload } = await jwtVerify(refreshToken, secret);
      // Sign new access token directly
      const { SignJWT } = await import("jose");
      const newAccessToken = await new SignJWT({ userId: payload.userId, username: payload.username, role: payload.role })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime(process.env.JWT_ACCESS_EXPIRES || "15m")
        .setIssuedAt()
        .sign(secret);
      const response = NextResponse.next();
      response.cookies.set("access_token", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 15,
      });
      return response;
    } catch {
      // Refresh token also invalid
    }
  }

  // Not authenticated, redirect to login
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 3: 创建 System Status API**

创建 `src/app/api/v1/system/status/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const userCount = await db.user.count();
    return NextResponse.json({
      initialized: userCount > 0,
    });
  } catch {
    return NextResponse.json({ initialized: false }, { status: 500 });
  }
}
```

- [ ] **Step 4: 创建 Setup API**

创建 `src/app/api/v1/auth/setup/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { setAuthCookies } from "@/lib/auth/session";

const setupSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  displayName: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  // Check if already initialized
  const userCount = await db.user.count();
  if (userCount > 0) {
    return NextResponse.json(
      { success: false, error: "System already initialized" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { username, password, displayName } = parsed.data;
  const passwordHash = await hashPassword(password);

  const user = await db.user.create({
    data: {
      username,
      passwordHash,
      displayName,
      role: "admin",
      isFirstLogin: false,
    },
  });

  const payload = { userId: user.id, username: user.username, role: user.role };
  const accessToken = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);

  const response = NextResponse.json({
    success: true,
    data: { id: user.id, username: user.username, displayName: user.displayName },
  });

  // Set cookies manually for the response
  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 15,
  });
  response.cookies.set("refresh_token", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
```

- [ ] **Step 5: 创建 Login API**

创建 `src/app/api/v1/auth/login/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "用户名和密码不能为空" },
      { status: 400 }
    );
  }

  const { username, password } = parsed.data;

  const user = await db.user.findFirst({
    where: { OR: [{ username }, { email: username }] },
  });

  if (!user) {
    return NextResponse.json(
      { success: false, error: "用户名或密码错误" },
      { status: 401 }
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json(
      { success: false, error: "用户名或密码错误" },
      { status: 401 }
    );
  }

  const payload = { userId: user.id, username: user.username, role: user.role };
  const accessToken = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);

  const response = NextResponse.json({
    success: true,
    data: { id: user.id, username: user.username, displayName: user.displayName },
  });

  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 15,
  });
  response.cookies.set("refresh_token", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
```

- [ ] **Step 6: 创建 Logout API**

创建 `src/app/api/v1/auth/logout/route.ts`：

```typescript
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("access_token");
  response.cookies.delete("refresh_token");
  return response;
}
```

- [ ] **Step 7: 创建 Refresh API**

创建 `src/app/api/v1/auth/refresh/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { verifyToken, signAccessToken, signRefreshToken } from "@/lib/auth/jwt";

export async function POST(request: Request) {
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!refreshToken) {
    return NextResponse.json({ success: false, error: "No refresh token" }, { status: 401 });
  }

  try {
    const payload = await verifyToken(refreshToken);
    const newAccessToken = await signAccessToken({
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    });
    const newRefreshToken = await signRefreshToken({
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set("access_token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 15,
    });
    response.cookies.set("refresh_token", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid refresh token" }, { status: 401 });
  }
}
```

- [ ] **Step 8: 验证认证 API 可运行**

```bash
pnpm dev
# 在另一个终端:
# 1. GET /api/v1/system/status → {"initialized": false}
# 2. POST /api/v1/auth/setup {"username":"admin","password":"admin123","displayName":"Admin"} → 200
# 3. POST /api/v1/auth/login {"username":"admin","password":"admin123"} → 200
# 4. POST /api/v1/auth/logout → 200
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add JWT auth middleware and API routes (login, logout, refresh, setup)"
```

---

## Task 5: 认证 UI 页面

**Files:**
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/setup/page.tsx`
- Create: `src/components/auth/login-form.tsx`
- Create: `src/components/auth/setup-wizard.tsx`

- [ ] **Step 1: 创建 Auth 布局**

创建 `src/app/(auth)/layout.tsx`：

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
```

- [ ] **Step 2: 创建 Login 页面**

创建 `src/app/(auth)/login/page.tsx`：

```tsx
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return <LoginForm />;
}
```

创建 `src/components/auth/login-form.tsx` — 复刻原型 `index.html` 的设计：

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Check if system is initialized on mount
  useEffect(() => {
    fetch("/api/v1/system/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.initialized) router.push("/setup");
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        router.push("/");
      } else {
        setError(data.error || "登录失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left decorative panel */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-primary via-primary-dark to-[#2B45C8] flex-col justify-center p-16 relative overflow-hidden">
        <div className="absolute top-[-120px] right-[-120px] w-[500px] h-[500px] rounded-full bg-white/[0.12] animate-pulse" />
        <div className="absolute bottom-[-80px] left-[-80px] w-[350px] h-[350px] rounded-full bg-white/[0.08] animate-pulse" />

        <div className="relative z-10">
          <div className="flex items-center gap-3.5 mb-12">
            <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            <span className="text-[26px] font-bold text-white font-display">Synthetix</span>
          </div>

          <h2 className="text-[32px] font-bold text-white/90 font-display leading-tight mb-3">
            AI-Powered Document Authoring
          </h2>
          <p className="text-base text-white/70 mb-12 max-w-[440px] leading-relaxed">
            Write, organize, and publish professional documents with intelligent assistance at every step.
          </p>

          <div className="flex flex-col gap-6">
            {[
              { title: "Smart Drafting", desc: "AI generates structured drafts from your outline in seconds, not hours." },
              { title: "Reference Management", desc: "Organize citations and references with automatic linking and formatting." },
              { title: "Model Management", desc: "Switch between AI models and fine-tune output to match your style." },
            ].map((feature) => (
              <div key={feature.title} className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-white/[0.12] backdrop-blur-sm border border-white/[0.15] flex items-center justify-center shrink-0">
                  <svg className="w-5.5 h-5.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /></svg>
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-white font-display">{feature.title}</h4>
                  <p className="text-[13px] text-white/65 leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-12 bg-gradient-to-b from-white to-[#FAFAF8]">
        <div className="w-full max-w-[400px]">
          <h2 className="text-2xl font-extrabold font-display mb-2">Welcome back</h2>
          <p className="text-sm text-muted-foreground mb-8">Sign in to your Synthetix account to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5" htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all disabled:opacity-40"
            >
              {loading ? "Signing in..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 Setup 向导页面**

创建 `src/app/(auth)/setup/page.tsx`：

```tsx
import { SetupWizard } from "@/components/auth/setup-wizard";

export default function SetupPage() {
  return <SetupWizard />;
}
```

创建 `src/components/auth/setup-wizard.tsx`：

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ username: "", password: "", confirmPassword: "", displayName: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (form.password.length < 6) {
      setError("密码至少 6 个字符");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, password: form.password, displayName: form.displayName }),
      });
      const data = await res.json();
      if (data.success) {
        router.push("/");
      } else {
        setError(typeof data.error === "string" ? data.error : "设置失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-6">
            <svg className="w-10 h-10 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="text-2xl font-bold font-display">Synthetix</span>
          </div>
          <h1 className="text-xl font-bold font-display">初次使用，创建管理员账号</h1>
          <p className="text-sm text-muted-foreground mt-2">设置您的管理员账号以开始使用</p>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1, 2].map((s) => (
            <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>

        <form onSubmit={handleSetup} className="bg-white rounded-2xl border shadow-sm p-6 space-y-5">
          {step === 1 && (
            <>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">用户名</label>
                <input
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="至少 3 个字符"
                  value={form.username}
                  onChange={(e) => updateField("username", e.target.value)}
                  required
                  minLength={3}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">显示名称</label>
                <input
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="您的名字"
                  value={form.displayName}
                  onChange={(e) => updateField("displayName", e.target.value)}
                  required
                />
              </div>
              <button type="button" onClick={() => setStep(2)} disabled={!form.username || !form.displayName}
                className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-40">
                下一步
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">密码</label>
                <input
                  type="password"
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="至少 6 个字符"
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">确认密码</label>
                <input
                  type="password"
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="再次输入密码"
                  value={form.confirmPassword}
                  onChange={(e) => updateField("confirmPassword", e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 py-3 border rounded-xl font-semibold hover:bg-base-gray transition-colors">
                  上一步
                </button>
                <button type="submit" disabled={loading || !form.password || !form.confirmPassword}
                  className="flex-1 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-40">
                  {loading ? "创建中..." : "创建账号"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 验证认证流程**

```bash
pnpm dev
# 删除 dev.db 重新初始化: rm prisma/dev.db && pnpm prisma migrate dev
# 1. 访问 http://localhost:3000 → 自动重定向到 /login → 检测到未初始化 → 重定向到 /setup
# 2. 填写管理员信息 → 创建成功 → 跳转到仪表盘
# 3. 登出后再访问 → 跳转到 /login → 可以登录
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add login and setup pages with auth flow"
```

---

## Task 6: Dashboard 布局 (Sidebar + Header)

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/components/layout/sidebar.tsx`
- Create: `src/components/layout/header.tsx`

- [ ] **Step 1: 创建 Sidebar 组件**

创建 `src/components/layout/sidebar.tsx`，复刻原型设计：

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { group: "工作区", items: [
    { href: "/", label: "仪表盘", icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
    { href: "/documents", label: "文档库", icon: "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" },
  ]},
  { group: "创作", items: [
    { href: "/brainstorm", label: "思路整理", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    { href: "/writing", label: "文档编写", icon: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" },
    { href: "/topology", label: "文档拓扑", icon: "M7.5 4.21v.01a1.99 1.99 0 0 1-1 1.73l-.5.29a1.99 1.99 0 0 0-1 1.73v.58a1.99 1.99 0 0 0 1 1.73l.5.29a1.99 1.99 0 0 1 1 1.73v.01" },
  ]},
  { group: "管理", items: [
    { href: "/models", label: "模型管理", icon: "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" },
    { href: "/settings", label: "系统设置", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" },
  ]},
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[260px] bg-white border-r flex flex-col z-50">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-[22px] border-b">
        <svg className="w-8 h-8 text-primary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <h1 className="text-[22px] font-semibold font-display">Synthetix</h1>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        {navItems.map((group) => (
          <div key={group.group} className="mb-7">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3.5 mb-2">
              {group.group}
            </div>
            {group.items.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors relative ${
                    isActive
                      ? "bg-primary-100 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-primary-50 hover:text-foreground"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
                  )}
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={item.icon} />
                  </svg>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="p-4 border-t">
        <div className="flex items-center gap-3 px-2 py-2.5 rounded-xl cursor-pointer hover:bg-base-gray transition-colors">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white font-semibold text-sm">
            A
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">Admin</div>
            <div className="text-xs text-muted-foreground">管理员</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: 创建 Header 组件**

创建 `src/components/layout/header.tsx`：

```tsx
"use client";

import { useRouter } from "next/navigation";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 bg-base/85 backdrop-blur-xl border-b px-8 h-16 flex items-center justify-between">
      <h1 className="text-[22px] font-semibold font-display">{title}</h1>
      <div className="flex items-center gap-3">
        {/* Notification bell placeholder */}
        <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-base-gray transition-colors text-muted-foreground">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        {/* Logout */}
        <button onClick={handleLogout} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-base-gray transition-colors text-muted-foreground" title="退出登录">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: 创建 Dashboard 布局**

创建 `src/app/(dashboard)/layout.tsx`：

```tsx
import { Sidebar } from "@/components/layout/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="ml-[260px]">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add dashboard layout with sidebar and header components"
```

---

## Task 7: 任务队列基础设施

**Files:**
- Create: `src/lib/queue/types.ts`
- Create: `src/lib/queue/queue.ts`
- Create: `src/__tests__/queue/queue.test.ts`
- Create: `src/app/api/v1/tasks/[id]/route.ts`

- [ ] **Step 1: 定义任务类型**

创建 `src/lib/queue/types.ts`：

```typescript
export type TaskType =
  | "document_upload"
  | "document_convert"
  | "rag_index"
  | "chapter_generate"
  | "chapter_summarize"
  | "outline_generate";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface TaskPayload {
  [key: string]: unknown;
}

export interface TaskResult {
  [key: string]: unknown;
}

export interface TaskInfo {
  id: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  result?: TaskResult;
  error?: string;
}
```

- [ ] **Step 2: 编写队列测试**

创建 `src/__tests__/queue/queue.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskQueue } from "@/lib/queue/queue";

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue({ maxConcurrency: 2, timeout: 5000 });
  });

  it("should submit a task and return a task ID", async () => {
    const taskId = await queue.submit("document_convert", { fileId: "test-1" });
    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe("string");
  });

  it("should execute a task and update status", async () => {
    const worker = vi.fn().mockResolvedValue({ markdown: "# Test" });
    queue.registerWorker("document_convert", worker);

    const taskId = await queue.submit("document_convert", { fileId: "test-1" });

    // Wait for task to complete
    await vi.waitFor(async () => {
      const status = await queue.getStatus(taskId);
      expect(status.status).toBe("completed");
    }, { timeout: 3000 });

    expect(worker).toHaveBeenCalledOnce();
  });

  it("should track progress", async () => {
    const worker = vi.fn().mockImplementation(async (payload, onProgress) => {
      onProgress(50);
      await new Promise((r) => setTimeout(r, 10));
      onProgress(100);
      return { done: true };
    });
    queue.registerWorker("document_convert", worker);

    const taskId = await queue.submit("document_convert", { fileId: "test-1" });
    await vi.waitFor(async () => {
      const status = await queue.getStatus(taskId);
      expect(status.status).toBe("completed");
    }, { timeout: 3000 });
  });

  it("should handle worker errors", async () => {
    const worker = vi.fn().mockRejectedValue(new Error("Conversion failed"));
    queue.registerWorker("document_convert", worker);

    const taskId = await queue.submit("document_convert", { fileId: "test-1" });

    await vi.waitFor(async () => {
      const status = await queue.getStatus(taskId);
      expect(status.status).toBe("failed");
      expect(status.error).toContain("Conversion failed");
    }, { timeout: 3000 });
  });

  it("should cancel a pending task", async () => {
    // Block workers to keep task pending
    queue.registerWorker("document_convert", () => new Promise(() => {}));
    queue.registerWorker("rag_index", () => new Promise(() => {}));

    // Fill concurrency
    await queue.submit("document_convert", {});
    await queue.submit("rag_index", {});

    // This one should be queued
    const taskId = await queue.submit("document_convert", { fileId: "test-1" });
    await queue.cancel(taskId);

    const status = await queue.getStatus(taskId);
    expect(status.status).toBe("cancelled");
  });
});
```

- [ ] **Step 3: 实现任务队列**

创建 `src/lib/queue/queue.ts`：

```typescript
import { v4 as uuid } from "uuid";
import type { TaskType, TaskStatus, TaskPayload, TaskResult, TaskInfo } from "./types";
import { db } from "@/lib/db";

type WorkerFn = (payload: TaskPayload, onProgress: (p: number) => void) => Promise<TaskResult>;

interface QueueOptions {
  maxConcurrency: number;
  timeout: number;
}

export class TaskQueue {
  private workers = new Map<TaskType, WorkerFn>();
  private options: QueueOptions;
  private running = 0;

  constructor(options?: Partial<QueueOptions>) {
    this.options = {
      maxConcurrency: options?.maxConcurrency ?? 3,
      timeout: options?.timeout ?? 600000,
    };
  }

  registerWorker(type: TaskType, worker: WorkerFn) {
    this.workers.set(type, worker);
  }

  async submit(type: TaskType, payload: TaskPayload): Promise<string> {
    const id = uuid();
    await db.asyncTask.create({
      data: {
        id,
        type,
        status: "pending",
        inputData: JSON.stringify(payload),
      },
    });
    this.processNext();
    return id;
  }

  async getStatus(taskId: string): Promise<TaskInfo> {
    const task = await db.asyncTask.findUnique({ where: { id: taskId } });
    if (!task) throw new Error(`Task ${taskId} not found`);
    return {
      id: task.id,
      type: task.type as TaskType,
      status: task.status as TaskStatus,
      progress: task.progress,
      result: task.resultData ? JSON.parse(task.resultData) : undefined,
      error: task.errorMessage ?? undefined,
    };
  }

  async cancel(taskId: string): Promise<void> {
    const task = await db.asyncTask.findUnique({ where: { id: taskId } });
    if (task && task.status === "pending") {
      await db.asyncTask.update({ where: { id: taskId }, data: { status: "cancelled" } });
    }
  }

  private processNext() {
    if (this.running >= this.options.maxConcurrency) return;
    this.running++;
    this.executeNext().finally(() => {
      this.running--;
      this.processNext();
    });
  }

  private async executeNext() {
    const task = await db.asyncTask.findFirst({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    if (!task) return;

    const worker = this.workers.get(task.type as TaskType);
    if (!worker) {
      await db.asyncTask.update({
        where: { id: task.id },
        data: { status: "failed", errorMessage: `No worker for type: ${task.type}` },
      });
      return;
    }

    await db.asyncTask.update({ where: { id: task.id }, data: { status: "running" } });

    const timeout = setTimeout(() => {
      db.asyncTask.update({
        where: { id: task.id },
        data: { status: "failed", errorMessage: "Task timed out" },
      });
    }, this.options.timeout);

    try {
      const payload = task.inputData ? JSON.parse(task.inputData) : {};
      const result = await worker(payload, async (progress: number) => {
        await db.asyncTask.update({ where: { id: task.id }, data: { progress } });
      });
      clearTimeout(timeout);
      await db.asyncTask.update({
        where: { id: task.id },
        data: { status: "completed", progress: 100, resultData: JSON.stringify(result) },
      });
    } catch (err) {
      clearTimeout(timeout);
      await db.asyncTask.update({
        where: { id: task.id },
        data: { status: "failed", errorMessage: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}

// Singleton
export const taskQueue = new TaskQueue();
```

- [ ] **Step 4: 运行队列测试**

```bash
pnpm test:run src/__tests__/queue/queue.test.ts
```

Expected: 5 tests PASS。

- [ ] **Step 5: 创建 Tasks API**

创建 `src/app/api/v1/tasks/[id]/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await db.asyncTask.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({
    success: true,
    data: {
      id: task.id,
      type: task.type,
      status: task.status,
      progress: task.progress,
      result: task.resultData ? JSON.parse(task.resultData) : null,
      error: task.errorMessage,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
  });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await db.asyncTask.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
  }
  if (task.status !== "pending" && task.status !== "running") {
    return NextResponse.json({ success: false, error: "Task cannot be cancelled" }, { status: 400 });
  }
  await db.asyncTask.update({ where: { id }, data: { status: "cancelled" } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add in-process task queue with tests and API"
```

---

## Task 8: LLM 适配层

**Files:**
- Create: `src/lib/llm/types.ts`
- Create: `src/lib/llm/adapter.ts`
- Create: `src/lib/llm/factory.ts`
- Create: `src/__tests__/llm/adapter.test.ts`

- [ ] **Step 1: 定义 LLM 类型**

创建 `src/lib/llm/types.ts`：

```typescript
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatChunk {
  content: string;
  done: boolean;
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  type: string;
}

export interface LLMProvider {
  chat(params: ChatParams): Promise<ChatResponse>;
  chatStream(params: ChatParams): AsyncGenerator<ChatChunk>;
  embed(texts: string[]): Promise<number[][]>;
  testConnection(): Promise<boolean>;
  getModels(): Promise<ModelInfo[]>;
}
```

- [ ] **Step 2: 编写适配器测试**

创建 `src/__tests__/llm/adapter.test.ts`：

```typescript
import { describe, it, expect, vi, beforeAll } from "vitest";
import { OpenAICompatibleAdapter } from "@/lib/llm/adapter";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OpenAICompatibleAdapter", () => {
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: "http://localhost:11434",
    apiKey: "",
  });

  beforeAll(() => {
    mockFetch.mockReset();
  });

  it("should test connection successfully", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ models: [] }) });
    const result = await adapter.testConnection();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("should handle connection failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await adapter.testConnection();
    expect(result).toBe(false);
  });

  it("should list models", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { id: "qwen2.5:7b", object: "model", owned_by: "ollama" },
          { id: "nomic-embed-text", object: "model", owned_by: "ollama" },
        ],
      }),
    });
    const models = await adapter.getModels();
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("qwen2.5:7b");
  });

  it("should send chat request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "Hello!", role: "assistant" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: "qwen2.5:7b",
      }),
    });
    const response = await adapter.chat({
      model: "qwen2.5:7b",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(response.content).toBe("Hello!");
    expect(response.inputTokens).toBe(10);
    expect(response.outputTokens).toBe(5);
  });
});
```

- [ ] **Step 3: 实现 OpenAI 兼容适配器**

创建 `src/lib/llm/adapter.ts`：

```typescript
import type { LLMProvider, ChatParams, ChatResponse, ChatChunk, ModelInfo } from "./types";

interface AdapterConfig {
  baseUrl: string;
  apiKey?: string;
}

export class OpenAICompatibleAdapter implements LLMProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: AdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey || "";
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens,
        stream: false,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Chat API error: ${res.status} ${error}`);
    }

    const data = await res.json();
    return {
      content: data.choices[0].message.content,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model,
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens,
        stream: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`Chat stream error: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          yield { content: "", done: true };
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content ?? "";
          if (content) yield { content, done: false };
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: "default", input: texts }),
    });

    if (!res.ok) {
      throw new Error(`Embed API error: ${res.status}`);
    }

    const data = await res.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`, {
      method: "GET",
      headers: this.headers(),
    });

    if (!res.ok) return [];

    const data = await res.json();
    return (data.data || []).map((m: { id: string; object: string; owned_by: string }) => ({
      id: m.id,
      name: m.id,
      type: m.owned_by || "unknown",
    }));
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }
}
```

- [ ] **Step 4: 创建适配器工厂**

创建 `src/lib/llm/factory.ts`：

```typescript
import { OpenAICompatibleAdapter } from "./adapter";
import type { LLMProvider } from "./types";
import { decrypt } from "@/lib/crypto";

interface ProviderConfig {
  apiBaseUrl: string;
  apiKey?: string | null;
}

export function createLLMProvider(config: ProviderConfig): LLMProvider {
  return new OpenAICompatibleAdapter({
    baseUrl: config.apiBaseUrl,
    apiKey: config.apiKey ? decrypt(config.apiKey) : undefined,
  });
}
```

- [ ] **Step 5: 运行 LLM 测试**

```bash
pnpm test:run src/__tests__/llm/adapter.test.ts
```

Expected: 4 tests PASS。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add OpenAI-compatible LLM adapter with tests"
```

---

## Task 9: 模型管理 API

**Files:**
- Create: `src/app/api/v1/models/providers/route.ts`
- Create: `src/app/api/v1/models/providers/[id]/route.ts`
- Create: `src/app/api/v1/models/providers/[id]/test/route.ts`
- Create: `src/app/api/v1/models/usage/route.ts`
- Create: `src/app/api/v1/users/profile/route.ts`
- Create: `src/app/api/v1/users/password/route.ts`

- [ ] **Step 1: 创建 Providers 列表+创建 API**

创建 `src/app/api/v1/models/providers/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const providers = await db.modelProvider.findMany({
    where: { userId: user.id },
    include: { models: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ success: true, data: providers });
}

const modelConfigSchema = z.object({
  modelId: z.string().min(1),
  modelName: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  contextWindow: z.number().int().min(1).default(4096),
  maxOutputTokens: z.number().int().optional(),
  supportsStreaming: z.boolean().default(true),
  inputPrice: z.number().optional(),
  outputPrice: z.number().optional(),
  localOrCloud: z.enum(["local", "cloud"]).default("local"),
  isDefaultFor: z.string().optional(),
});

const providerSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: z.enum(["ollama", "openai_compatible", "anthropic", "custom"]),
  apiBaseUrl: z.string().url(),
  apiKey: z.string().optional(),
  models: z.array(modelConfigSchema).min(1),
});

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = providerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, providerType, apiBaseUrl, apiKey, models } = parsed.data;

  const provider = await db.modelProvider.create({
    data: {
      userId: user.id,
      name,
      providerType,
      apiBaseUrl,
      apiKey: apiKey ? encrypt(apiKey) : null,
      models: {
        create: models.map((m) => ({
          modelId: m.modelId,
          modelName: m.modelName,
          capabilities: JSON.stringify(m.capabilities),
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          supportsStreaming: m.supportsStreaming,
          inputPrice: m.inputPrice,
          outputPrice: m.outputPrice,
          localOrCloud: m.localOrCloud,
          isDefaultFor: m.isDefaultFor,
        })),
      },
    },
    include: { models: true },
  });

  return NextResponse.json({ success: true, data: provider }, { status: 201 });
}
```

- [ ] **Step 2: 创建 Provider 详情/更新/删除 API**

创建 `src/app/api/v1/models/providers/[id]/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const provider = await db.modelProvider.findFirst({
    where: { id, userId: user.id },
    include: { models: true },
  });

  if (!provider) {
    return NextResponse.json({ success: false, error: "Provider not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: provider });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { name, apiBaseUrl, apiKey, isActive } = body;

  const existing = await db.modelProvider.findFirst({ where: { id, userId: user.id } });
  if (!existing) {
    return NextResponse.json({ success: false, error: "Provider not found" }, { status: 404 });
  }

  const provider = await db.modelProvider.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(apiBaseUrl !== undefined && { apiBaseUrl }),
      ...(apiKey !== undefined && { apiKey: encrypt(apiKey) }),
      ...(isActive !== undefined && { isActive }),
    },
    include: { models: true },
  });

  return NextResponse.json({ success: true, data: provider });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await db.modelProvider.findFirst({ where: { id, userId: user.id } });
  if (!existing) {
    return NextResponse.json({ success: false, error: "Provider not found" }, { status: 404 });
  }

  await db.modelProvider.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: 创建连接测试 API**

创建 `src/app/api/v1/models/providers/[id]/test/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { createLLMProvider } from "@/lib/llm/factory";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const provider = await db.modelProvider.findFirst({
    where: { id, userId: user.id },
  });

  if (!provider) {
    return NextResponse.json({ success: false, error: "Provider not found" }, { status: 404 });
  }

  try {
    const llm = createLLMProvider({ apiBaseUrl: provider.apiBaseUrl, apiKey: provider.apiKey });
    const connected = await llm.testConnection();

    if (connected) {
      const models = await llm.getModels();
      return NextResponse.json({ success: true, data: { connected: true, models } });
    }
    return NextResponse.json({ success: true, data: { connected: false } });
  } catch (err) {
    return NextResponse.json({
      success: true,
      data: { connected: false, error: err instanceof Error ? err.message : String(err) },
    });
  }
}
```

- [ ] **Step 4: 创建 Usage API**

创建 `src/app/api/v1/models/usage/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const module = searchParams.get("module");
  const days = parseInt(searchParams.get("days") || "30");

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where = {
    userId: user.id,
    createdAt: { gte: since },
    ...(module && { module }),
  };

  const [usage, summary] = await Promise.all([
    db.tokenUsage.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
    db.tokenUsage.aggregate({
      where,
      _sum: { inputTokens: true, outputTokens: true, costEstimate: true },
      _count: true,
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      usage,
      summary: {
        totalInputTokens: summary._sum.inputTokens ?? 0,
        totalOutputTokens: summary._sum.outputTokens ?? 0,
        totalCost: summary._sum.costEstimate ?? 0,
        totalCalls: summary._count,
      },
    },
  });
}
```

- [ ] **Step 5: 创建 Users API**

创建 `src/app/api/v1/users/profile/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });

  return NextResponse.json({
    success: true,
    data: {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      displayName: dbUser.displayName,
      avatarUrl: dbUser.avatarUrl,
      role: dbUser.role,
      createdAt: dbUser.createdAt,
    },
  });
}

const profileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
});

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: parsed.data,
  });

  return NextResponse.json({
    success: true,
    data: { id: updated.id, username: updated.username, displayName: updated.displayName },
  });
}
```

创建 `src/app/api/v1/users/password/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/auth/password";

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;
  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });

  const valid = await verifyPassword(currentPassword, dbUser.passwordHash);
  if (!valid) {
    return NextResponse.json({ success: false, error: "当前密码错误" }, { status: 400 });
  }

  const newHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add model management and user profile API routes"
```

---

## Task 10: 模型管理 UI

**Files:**
- Create: `src/app/(dashboard)/models/page.tsx`
- Create: `src/components/models/models-tabs.tsx`
- Create: `src/components/models/provider-form.tsx`

- [ ] **Step 1: 创建 Models 页面**

创建 `src/app/(dashboard)/models/page.tsx`：

```tsx
import { Header } from "@/components/layout/header";
import { ModelsTabs } from "@/components/models/models-tabs";

export default function ModelsPage() {
  return (
    <div>
      <Header title="模型管理" />
      <div className="p-8">
        <ModelsTabs />
      </div>
    </div>
  );
}
```

创建 `src/components/models/models-tabs.tsx` — 完整的模型管理界面，包含提供商列表、添加/编辑对话框、连接测试、用量统计。这个组件较大，需要包含：

- 提供商列表 Tab
- 添加提供商的 Dialog（表单 + 连接测试）
- 用量统计 Tab
- 删除确认

实现时参考原型 `f6-models.html` 的设计，使用 shadcn/ui 的 Tabs、Dialog、Card 组件。

- [ ] **Step 2: 创建 Provider 表单组件**

创建 `src/components/models/provider-form.tsx` — 添加/编辑提供商的表单组件，包含：
- 提供商名称、类型选择
- API 地址输入
- API Key 输入（可选）
- 模型配置列表（动态添加/删除）
- 连接测试按钮
- 保存/取消

实现时参考原型中的表单设计。

- [ ] **Step 3: 验证模型管理页面**

```bash
pnpm dev
# 1. 登录后访问 /models
# 2. 点击"添加提供商"
# 3. 填写 Ollama 配置（http://localhost:11434）
# 4. 测试连接
# 5. 保存
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add model management page with provider form and usage tabs"
```

---

## Task 11: 仪表盘页面

**Files:**
- Create: `src/app/(dashboard)/page.tsx`
- Create: `src/components/shared/stats-card.tsx`

- [ ] **Step 1: 创建 StatsCard 组件**

创建 `src/components/shared/stats-card.tsx`：

```tsx
interface StatsCardProps {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string | number;
  change?: string;
  changeType?: "up" | "down";
}

export function StatsCard({ icon, iconClass, label, value, change, changeType }: StatsCardProps) {
  return (
    <div className="bg-white border rounded-2xl p-6 flex items-start gap-4 hover:border-gray-300 hover:shadow-md transition-all">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${iconClass}`}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="text-[13px] text-muted-foreground mb-1">{label}</div>
        <div className="font-display text-[28px] font-bold leading-tight">{value}</div>
        {change && (
          <div className={`text-xs font-medium mt-1 ${changeType === "up" ? "text-green-600" : "text-red-600"}`}>
            {change}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建仪表盘页面**

创建 `src/app/(dashboard)/page.tsx`，参考原型 `dashboard.html`：

```tsx
import { Header } from "@/components/layout/header";
import { StatsCard } from "@/components/shared/stats-card";
import Link from "next/link";

export default function DashboardPage() {
  const stats = [
    { icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /></svg>, iconClass: "bg-primary-100 text-primary", label: "文档总数", value: 0 },
    { icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /></svg>, iconClass: "bg-green-100 text-green-600", label: "草稿数量", value: 0 },
    { icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /></svg>, iconClass: "bg-orange-100 text-orange-600", label: "引用数量", value: 0 },
    { icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4" /></svg>, iconClass: "bg-blue-100 text-blue-600", label: "Token 消耗", value: "0" },
  ];

  const quickActions = [
    { href: "/documents", label: "上传文档", desc: "上传参考资料并转换", icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" },
    { href: "/brainstorm", label: "开始头脑风暴", desc: "AI 辅助理清思路", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    { href: "/writing", label: "创建草稿", desc: "开始编写文档", icon: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" },
    { href: "/documents", label: "浏览文档库", desc: "搜索和管理文档", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  ];

  return (
    <div>
      <Header title="仪表盘" />
      <div className="p-8">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {stats.map((s) => (
            <StatsCard key={s.label} {...s} />
          ))}
        </div>

        {/* Quick Actions */}
        <h2 className="text-lg font-semibold font-display mb-4">快捷操作</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {quickActions.map((a) => (
            <Link key={a.href} href={a.href} className="bg-white border rounded-2xl p-5 hover:border-primary/30 hover:shadow-md transition-all group">
              <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary flex items-center justify-center mb-3 group-hover:bg-primary-100 transition-colors">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={a.icon} /></svg>
              </div>
              <h3 className="font-semibold text-sm mb-1">{a.label}</h3>
              <p className="text-xs text-muted-foreground">{a.desc}</p>
            </Link>
          ))}
        </div>

        {/* Recent Documents - Placeholder for P1 */}
        <h2 className="text-lg font-semibold font-display mb-4">最近文档</h2>
        <div className="bg-white border rounded-2xl p-12 flex flex-col items-center justify-center text-center">
          <svg className="w-16 h-16 text-muted-foreground/40 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /></svg>
          <h3 className="font-semibold text-lg mb-2">暂无文档</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-[400px]">上传参考资料，开始您的第一个文档创作</p>
          <Link href="/documents" className="px-6 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all text-sm">上传文档</Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add dashboard page with stats, quick actions, and empty state"
```

---

## Task 12: 用户设置页面

**Files:**
- Create: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: 创建 Settings 页面**

创建 `src/app/(dashboard)/settings/page.tsx`：

```tsx
"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";

interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/v1/users/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setProfile(data.data);
          setDisplayName(data.data.displayName);
          setEmail(data.data.email || "");
        }
      });
  }, []);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/v1/users/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, email: email || null }),
    });
    const data = await res.json();
    setMessage(data.success ? { type: "success", text: "个人信息已更新" } : { type: "error", text: data.error || "更新失败" });
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/v1/users/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (data.success) {
      setCurrentPassword("");
      setNewPassword("");
      setMessage({ type: "success", text: "密码已修改" });
    } else {
      setMessage({ type: "error", text: data.error || "修改失败" });
    }
  }

  return (
    <div>
      <Header title="系统设置" />
      <div className="p-8 max-w-2xl">
        {message && (
          <div className={`mb-6 px-4 py-3 rounded-xl text-sm ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message.text}
          </div>
        )}

        {/* Profile */}
        <div className="bg-white border rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold font-display mb-4">个人信息</h2>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">用户名</label>
              <input className="w-full px-3.5 py-2.5 border rounded-xl text-sm bg-base-gray" value={profile?.username || ""} disabled />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">显示名称</label>
              <input className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">邮箱</label>
              <input type="email" className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="可选" />
            </div>
            <button type="submit" className="px-6 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all text-sm">保存</button>
          </form>
        </div>

        {/* Password */}
        <div className="bg-white border rounded-2xl p-6">
          <h2 className="text-lg font-semibold font-display mb-4">修改密码</h2>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">当前密码</label>
              <input type="password" className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">新密码</label>
              <input type="password" className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
            </div>
            <button type="submit" className="px-6 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all text-sm">修改密码</button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add user settings page with profile and password management"
```

---

## 自检清单

完成所有任务后，运行以下验证：

```bash
# 1. 运行所有测试
pnpm test:run
# Expected: All tests pass

# 2. 构建检查
pnpm build
# Expected: Build succeeds

# 3. 完整流程验证
pnpm dev
# - 访问 / → 重定向到 /setup
# - 创建管理员账号 → 跳转仪表盘
# - 访问 /models → 查看模型管理
# - 访问 /settings → 修改个人信息
# - 登出 → 跳转到 /login → 重新登录
```
