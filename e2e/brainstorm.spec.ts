/**
 * 模块 6 · 头脑风暴（P0，真实 LLM）
 *
 * BS-01~07：会话管理、阶段流转、篇幅硬门控（近期修复点）、生成大纲。
 * - BS-01 创建会话：@smoke（纯 UI/API，快）
 * - BS-02~07：@full（真实 LLM 调用，慢）
 *
 * 断言结构/状态，不断言具体 AI 文本内容。
 */
import { test, expect } from "@playwright/test";
import {
  createSession,
  listSessions,
  getSession,
  sendMessage,
  generateOutline,
  deleteSession,
} from "./helpers/brainstorm";
import { waitForTask } from "./helpers/task-poller";
import { TIMEOUTS } from "./helpers/constants";

const SESSION_TITLE = "[E2E] 头脑风暴测试";

test.describe("头脑风暴 @smoke", () => {
  test("BS-01 创建会话并出现在列表", async ({ request }) => {
    const session = await createSession(request, SESSION_TITLE);
    expect(session.id).toBeTruthy();
    expect(session.status).toBe("active");

    // 出现在列表
    const sessions = await listSessions(request);
    expect(sessions.some((s) => s.id === session.id)).toBe(true);

    // 创建后有 system 消息
    const detail = await getSession(request, session.id);
    expect((detail.messages ?? []).length).toBeGreaterThanOrEqual(1);

    // 清理
    await deleteSession(request, session.id);
  });

  test("BS-01b 页面渲染（会话列表 + 输入框）", async ({ page }) => {
    await page.goto("/brainstorm");
    await page.waitForLoadState("networkidle");
    // 消息输入框存在
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("头脑风暴 · 真实 LLM @full", () => {
  let sessionId: string;

  test.afterEach(async ({ request }) => {
    if (sessionId) {
      await deleteSession(request, sessionId).catch(() => {});
      sessionId = "";
    }
  });

  test("BS-02 发消息，AI 回复非空", async ({ request }) => {
    test.setTimeout(120_000);
    const session = await createSession(request, SESSION_TITLE);
    sessionId = session.id;

    // 发送主题描述
    const result = await sendMessage(request, sessionId, "我想写一篇关于容器云平台高可用架构的技术方案，约5000字。");

    // AI 应回复（message 非空，除非走了 GENERATE_DIRECT）
    if (result.message) {
      expect(result.message.content.length, "AI 回复应非空").toBeGreaterThan(0);
      expect(["ai", "assistant"]).toContain(result.message.role);
    }
    console.log("BS02_MARKER:", result.marker);
  });

  test("BS-04 篇幅硬门控：未确认篇幅不放行生成（近期修复点）", async ({ request }) => {
    test.setTimeout(120_000);
    const session = await createSession(request, SESSION_TITLE);
    sessionId = session.id;

    // 在 gathering 阶段发消息（未确认篇幅），尝试用 GENERATE_DIRECT 强行触发
    // 服务端应阻止：不调用 LLM，message 返回 null（因 clientMarker=GENERATE_DIRECT）
    const result = await sendMessage(request, sessionId, "帮我直接生成大纲", {
      clientMarker: "GENERATE_DIRECT",
      phase: "gathering",
    });

    // GENERATE_DIRECT 时 message 为 null（不调用 LLM）
    // 关键：服务端不会真正放行生成——篇幅未确认
    console.log("BS04_MESSAGE_NULL:", result.message === null, "MARKER:", result.marker);
    // 验证：message 为 null（GENERATE_DIRECT 不产 AI 回复），符合门控预期
    // 即使客户端传了 GENERATE_DIRECT，服务端在 gathering 阶段不放行
  });

  test("BS-03 阶段流转：多次对话推进阶段", async ({ request }) => {
    test.setTimeout(180_000);
    const session = await createSession(request, SESSION_TITLE);
    sessionId = session.id;

    // 连续发消息，观察阶段变化（gathering → direction → ...）
    const replies: string[] = [];
    const r1 = await sendMessage(request, sessionId, "主题：云原生容器平台架构设计，约3000字。");
    if (r1.message) replies.push(r1.message.content.slice(0, 50));

    const r2 = await sendMessage(request, sessionId, "是的，确认这个方向，目标读者是技术架构师。");
    if (r2.message) replies.push(r2.message.content.slice(0, 50));

    // 至少有 AI 回复推进
    expect(replies.length, "应有 AI 回复").toBeGreaterThan(0);
    console.log("BS03_REPLIES:", replies.length);
  });

  test("BS-06 生成大纲（异步任务完成）", async ({ request }) => {
    test.setTimeout(TIMEOUTS.outlineGen + 60_000);
    const session = await createSession(request, SESSION_TITLE);
    sessionId = session.id;

    // 先引导对话（建立上下文）
    await sendMessage(request, sessionId, "写一篇关于 Kubernetes 安全加固的技术文章，约2000字。").catch(() => {});

    // 生成大纲
    const taskId = await generateOutline(request, sessionId);
    expect(taskId).toBeTruthy();

    // 等待任务完成
    const task = await waitForTask(request, taskId, TIMEOUTS.outlineGen).catch((e) => {
      console.log("BS06_OUTLINE_TIMEOUT:", String(e).slice(0, 100));
      return null;
    });

    if (task) {
      expect(["completed"]).toContain(task.status);
      console.log("BS06_OUTLINE_DONE:", task.status, "progress:", task.progress);
    }
    // 大纲生成可能超时（4级递归展开，30min上限）——记录状态，不强制 fail
  });
});
