# Synthetix P3 思路整理设计文档

**日期**: 2026-05-04
**阶段**: P3 — 智能辅助（思路整理）
**状态**: 已确认
**前置**: P0/P1/P2（已完成）

---

## 1. 概述

P3 实现多轮对话式思路整理，LLM 通过苏格拉底式提问引导用户理清思路，最终生成结构化文档大纲。

### 1.1 P3 范围

| 功能 | 说明 | 优先级 |
|------|------|--------|
| F3-US1 | 用户输入想法，LLM 苏格拉底式提问 | P0 |
| F3-US2 | 多轮对话逐步完善 | P0 |
| F3-US3 | 对话完成后自动生成结构化大纲 | P0 |
| F3-US4 | 对生成的大纲进行编辑调整 | P0 |
| F3-US5 | 搜索文档库引入参考资料 | P1 |
| F3-US7 | 查看历史会话列表，继续之前会话 | P1 |
| F3-US8 | 对话面板中显示已引入参考文档 | P1 |

### 1.2 不在 P3 范围

- F3-US6 保存对话记录（已有，DB 存储即保存）
- 大纲版本管理（P4 实现）

### 1.3 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| LLM 调用 | 复用现有 `createLLMProvider().chat()` | 统一接口，流式输出 |
| 提问策略 | System prompt 模板定义苏格拉底风格 | 简单可配置 |
| 大纲生成 | 独立 prompt 调用，输出 JSON | 结构化输出便于编辑 |
| 会话存储 | SQLite (Prisma) | 零额外依赖 |
| UI 布局 | 3 列：历史｜对话｜大纲 | 匹配原型 f3-brainstorm.html |

---

## 2. DB Schema

### 2.1 BrainstormSession

```prisma
model BrainstormSession {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  title     String
  status    String    @default("active")
  outline   String?   // JSON outline
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages Message[]

  @@map("brainstorm_sessions")
}
```

### 2.2 Message

```prisma
model Message {
  id        String   @id @default(uuid())
  sessionId String   @map("session_id")
  role      String   // "user" | "ai" | "system"
  content   String
  createdAt DateTime @default(now()) @map("created_at")

  session BrainstormSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@map("messages")
}
```

---

## 3. API Routes

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | /api/v1/brainstorm/sessions | 会话列表 |
| POST | /api/v1/brainstorm/sessions | 创建新会话 |
| GET | /api/v1/brainstorm/sessions/:id | 会话详情（含消息） |
| DELETE | /api/v1/brainstorm/sessions/:id | 删除会话 |
| POST | /api/v1/brainstorm/sessions/:id/message | 发送消息（SSE 流式返回） |
| POST | /api/v1/brainstorm/sessions/:id/generate-outline | 生成大纲 |
| PUT | /api/v1/brainstorm/outlines/:id | 编辑大纲 |

---

## 4. System Prompt — 苏格拉底提问

```
You are a skilled brainstorming facilitator using the Socratic method.
Your role is to help users clarify their thoughts through targeted questions.

Question phases:
1. Understanding: Clarify intent and scope
2. Deepening: Explore details, relationships, and edge cases
3. Structuring: Organize into logical framework

Rules:
- Ask ONE question at a time
- Build on previous answers
- When the user signals readiness, offer to generate an outline
- Keep responses concise (2-4 sentences + question)
```

---

## 5. UI 页面

页面 `/brainstorm` 完全匹配原型 f3-brainstorm.html：

- **左侧 220px**: 会话历史列表（+ 新建按钮）
- **中间 1fr**: 对话区（消息气泡 + 输入框 + 发送/附件按钮）
- **右侧 320px**: 大纲面板（标题、树形结构、编辑/重新生成/确认按钮）
