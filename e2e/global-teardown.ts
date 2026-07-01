/**
 * Global Teardown（config.globalTeardown）— 清理本次测试创建的 [E2E] 命名资源。
 * 尽力清理，失败不阻断。测试文档（大/小文档）的删除由各用例自行负责。
 *
 * 这是一个普通 async 函数，不是测试用例。
 */
import { request } from "@playwright/test";
import { ADMIN } from "./helpers/constants";

export default async function globalTeardown() {
  const ctx = await request.newContext({
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
  });

  // 登录（teardown 是独立 context）
  await ctx.post("/api/v1/auth/login", {
    data: { username: ADMIN.username, password: ADMIN.password },
  }).catch(() => {});

  const safeDelete = async (url: string) => {
    try { await ctx.delete(url); } catch { /* best-effort */ }
  };

  // 草稿：按标题 [E2E] 前缀过滤
  try {
    const res = await ctx.get("/api/v1/drafts");
    const body = await res.json();
    const drafts = (body.data ?? []) as { id: string; title?: string }[];
    for (const d of drafts) {
      if (d.title?.includes("[E2E]")) await safeDelete(`/api/v1/drafts/${d.id}`);
    }
  } catch { /* ignore */ }

  // 头脑风暴会话
  try {
    const res = await ctx.get("/api/v1/brainstorm/sessions");
    const body = await res.json();
    const sessions = (body.data ?? []) as { id: string; title?: string }[];
    for (const s of sessions) {
      if (s.title?.includes("[E2E]")) await safeDelete(`/api/v1/brainstorm/sessions/${s.id}`);
    }
  } catch { /* ignore */ }

  await ctx.dispose();
}
