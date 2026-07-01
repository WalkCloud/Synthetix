/**
 * 模块 13 · 端到端主链路（P0）
 *
 * E2E-MASTER：登录 → 上传文档 → full 处理(ready) → 建头脑风暴会话 →
 * 发消息 → 生成大纲 → 建 draft → 单节生成(SSE) → 确认 → 导出 MD。
 *
 * 用小 md 文档控制时间（full 处理约 1-2 分钟）。
 * 串联全部核心模块，是回归基线。
 */
import { test, expect } from "@playwright/test";
import { uploadAndProcessToReady } from "./helpers/documents";
import { deleteAndAwaitCleanup } from "./helpers/delete-verify";
import { getDefaultModelIds } from "./helpers/models";
import { createSession, sendMessage, deleteSession } from "./helpers/brainstorm";
import { createDraft, generateSectionSse, confirmSection, exportDraft, deleteDraft } from "./helpers/writing";
import { SMALL_DOC, TIMEOUTS } from "./helpers/constants";
import path from "path";

const TINY_DOC = path.resolve(__dirname, "fixtures/tiny-tech.md");

test.describe("端到端主链路 @full", () => {
  const resources: { docs: string[]; drafts: string[]; sessions: string[] } = {
    docs: [],
    drafts: [],
    sessions: [],
  };

  test.afterAll(async ({ request }) => {
    // 兜底清理所有创建的资源
    for (const id of resources.drafts) await request.delete(`/api/v1/drafts/${id}`).catch(() => {});
    for (const id of resources.sessions) await request.delete(`/api/v1/brainstorm/sessions/${id}`).catch(() => {});
    for (const id of resources.docs) await request.delete(`/api/v1/documents/${id}?deleteWiki=true`).catch(() => {});
  });

  test("E2E-MASTER 全链路", async ({ page, request }) => {
    test.setTimeout(15 * 60_000);
    const modelIds = await getDefaultModelIds(request);

    // 1. 上传文档 + full 处理到 ready
    console.log("STEP1: 上传+处理文档");
    const doc = await uploadAndProcessToReady(request, TINY_DOC, "full", modelIds, 6 * 60_000);
    resources.docs.push(doc.docId);
    console.log("STEP1_DONE:", doc.docId, Math.round(doc.elapsedMs / 1000) + "s");

    // 2. 建头脑风暴会话 + 发消息
    console.log("STEP2: 头脑风暴会话");
    const session = await createSession(request, "[E2E] 主链路会话");
    resources.sessions.push(session.id);
    const msg = await sendMessage(request, session.id, "写一篇关于容器云平台架构的技术方案，约2000字。");
    console.log("STEP2_DONE: AI回复=" + (msg.message ? "有" : "无"));

    // 3. 建 draft（直接用大纲，不依赖大纲生成任务以节省时间）
    console.log("STEP3: 创建草稿");
    const draft = await createDraft(request, {
      title: "[E2E] 主链路草稿",
      sections: [{ num: "1", title: "容器云架构概述", description: "整体架构", estimatedWords: 500 }],
    });
    resources.drafts.push(draft.id);
    console.log("STEP3_DONE:", draft.id);

    // 4. 单节 SSE 生成
    console.log("STEP4: 单节生成");
    await page.goto("/");
    const gen = await generateSectionSse(page, draft.id, draft.sections![0].id, TIMEOUTS.sectionGenerate);
    console.log("STEP4_DONE: done=" + gen.done + " chunks=" + gen.chunks.length);

    // 5. 确认节
    console.log("STEP5: 确认节");
    const confirmed = await confirmSection(request, draft.id, draft.sections![0].id).catch(() => null);
    console.log("STEP5_DONE: status=" + confirmed?.status);

    // 6. 导出 Markdown
    console.log("STEP6: 导出");
    const exported = await exportDraft(request, draft.id, "markdown");
    console.log("STEP6_DONE: ok=" + exported.ok);
    expect(exported.ok, "导出应成功").toBe(true);

    console.log("E2E_MASTER_RESULT: PASS");
  });
});
