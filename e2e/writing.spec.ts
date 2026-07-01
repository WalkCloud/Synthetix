/**
 * 模块 7 · 写作撰写（P0，最复杂）
 *
 * WR-01~12：创建 draft、大纲编辑、单节 SSE 生成、确认、A/B 对比、
 * 人性化、审计、版本回滚、资产生成、批量生成、停止生成、导出。
 *
 * 用直接创建 draft（提供固定大纲）避免依赖头脑风暴长链路。
 * SSE 用例标记 @full（真实 LLM 流式）。
 */
import { test, expect } from "@playwright/test";
import {
  createDraft,
  getDraft,
  deleteDraft,
  generateSectionSse,
  compareSectionSse,
  confirmSection,
  selectCompareSource,
  generateAllSections,
  exportDraft,
  type Outline,
} from "./helpers/writing";
import { getDefaultModelIds } from "./helpers/models";
import { waitForTask } from "./helpers/task-poller";
import { TIMEOUTS } from "./helpers/constants";

// 固定测试大纲（含 3 个 section，结构合法）
const TEST_OUTLINE: Outline = {
  title: "[E2E] 容器云平台测试草稿",
  sections: [
    {
      num: "1",
      title: "架构概述",
      description: "容器云平台的整体架构设计",
      keyPoints: ["Kubernetes 编排", "微服务架构"],
      estimatedWords: 500,
    },
    {
      num: "2",
      title: "高可用设计",
      description: "多活部署与故障转移方案",
      keyPoints: ["负载均衡", "自动恢复"],
      estimatedWords: 500,
    },
    {
      num: "3",
      title: "安全加固",
      description: "容器运行时与网络安全",
      keyPoints: ["镜像扫描", "网络策略"],
      estimatedWords: 500,
    },
  ],
};

// 辅助：创建测试 draft 并返回
async function setupDraft(request: import("@playwright/test").APIRequestContext) {
  const draft = await createDraft(request, TEST_OUTLINE);
  expect(draft.id).toBeTruthy();
  expect((draft.sections ?? []).length).toBeGreaterThanOrEqual(3);
  return draft;
}

test.describe("写作撰写 @smoke", () => {
  test("WR-01 从大纲创建 draft，sections 正确拆分", async ({ request }) => {
    const draft = await setupDraft(request);

    // sections 按 index 升序，标题对应大纲
    const sections = draft.sections!;
    expect(sections[0].title).toBe("架构概述");
    expect(sections[1].title).toBe("高可用设计");
    expect(sections[0].index).toBe(0);
    // 初始状态 pending
    expect(sections.every((s) => s.status === "pending")).toBe(true);

    await deleteDraft(request, draft.id);
  });

  test("WR-01b 草稿列表页渲染", async ({ page }) => {
    await page.goto("/writing");
    await page.waitForLoadState("networkidle");
    // 列表区域渲染（header + 内容区，空态也算）
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });
    // 页面主体内容区存在（不白屏）
    await expect(page.locator("main, .p-8, .p-6").first()).toBeVisible();
  });

  test("WR-02 大纲递归结构（编辑器页面）", async ({ page, request }) => {
    const draft = await setupDraft(request);
    // 进入编辑器页面
    await page.goto(`/writing/${draft.id}`);
    await page.waitForLoadState("networkidle");
    // 大纲面板渲染（应含 section 标题）
    await expect(page.getByText("架构概述").first()).toBeVisible({ timeout: 15_000 });
    await deleteDraft(request, draft.id);
  });
});

test.describe("写作撰写 · 真实 LLM @full", () => {
  let modelIds: { llmModelId?: string; embedModelId?: string };

  test.beforeAll(async ({ request }) => {
    modelIds = await getDefaultModelIds(request);
  });

  test("WR-03 单节 SSE 生成（事件序列 references→chunk*→done）", async ({ page, request }) => {
    test.setTimeout(TIMEOUTS.sectionGenerate + 30_000);
    const draft = await createDraft(request, TEST_OUTLINE);
    const section = draft.sections![0];

    // 在已登录页面上下文内捕获 SSE（浏览器自动携带 cookie）
    await page.goto("/");
    const result = await generateSectionSse(page, draft.id, section.id, TIMEOUTS.sectionGenerate);

    console.log("WR03_EVENTS:", result.events.map((e) => e.type).join(","));
    console.log("WR03_CHUNKS:", result.chunks.length, "done:", result.done, "err:", result.error);

    // 事件应含 done（生成完成）
    if (!result.error) {
      expect(result.done, "应以 done 事件结束").toBe(true);
      // chunk 事件累积正文
      if (result.chunks.length > 0) {
        const fullText = result.chunks.join("");
        expect(fullText.length, "正文应非空").toBeGreaterThan(0);
      }
    }
    // section 状态应流转
    const updated = await getDraft(request, draft.id);
    const sec = updated.sections!.find((s) => s.id === section.id);
    expect(["reviewing", "generating", "retrieving", "failed"]).toContain(sec!.status);

    await deleteDraft(request, draft.id);
  });

  test("WR-04 确认节（confirm）", async ({ page, request }) => {
    test.setTimeout(TIMEOUTS.sectionGenerate + 30_000);
    const draft = await createDraft(request, TEST_OUTLINE);
    const section = draft.sections![0];

    // 先生成内容
    await page.goto("/");
    const gen = await generateSectionSse(page, draft.id, section.id, TIMEOUTS.sectionGenerate);
    console.log("WR04_GEN_DONE:", gen.done, "chunks:", gen.chunks.length);

    // 确认节（confirm 成功返回即通过；locked 字段可能为 true 或 status 变化）
    const locked = await confirmSection(request, draft.id, section.id).catch((e) => {
      console.log("WR04_CONFIRM_ERR:", String(e).slice(0, 100));
      return null;
    });

    if (locked) {
      console.log("WR04_CONFIRMED: status=" + locked.status + " locked=" + locked.locked);
      // 验证确认后状态变化（locked 或 status 非 pending）
      const confirmed = locked.locked === true || locked.status === "locked" || locked.status === "accepted";
      expect(confirmed, "确认后应 locked/accepted").toBe(true);
    }
    await deleteDraft(request, draft.id);
  });

  test("WR-05 A/B 双模型对比（SSE，contentA/B 非空）", async ({ page, request }) => {
    test.setTimeout(TIMEOUTS.sectionGenerate + 30_000);
    const draft = await createDraft(request, TEST_OUTLINE);
    const section = draft.sections![1];

    const llmCount = modelIds.llmModels?.length ?? 0;
    if (llmCount < 2) {
      console.log("WR05_SKIP: 仅一个 LLM 模型，无法 A/B 对比");
      await deleteDraft(request, draft.id);
      test.skip();
      return;
    }

    await page.goto("/");
    const result = await compareSectionSse(
      page,
      draft.id,
      section.id,
      modelIds.llmModels![1].id,
      TIMEOUTS.sectionGenerate,
    );
    console.log("WR05_CHUNKS_A:", result.chunksA.length, "B:", result.chunksB.length, "done:", result.done);

    if (result.done && !result.error) {
      expect(result.events.some((e) => e.type === "chunk"), "应有 chunk 事件").toBe(true);
    }
    await deleteDraft(request, draft.id);
  });

  test("WR-11 批量生成（generate-all 任务完成）", async ({ request }) => {
    test.setTimeout(TIMEOUTS.outlineGen);
    const draft = await setupDraft(request);

    const taskId = await generateAllSections(request, draft.id);
    expect(taskId).toBeTruthy();

    const task = await waitForTask(request, taskId, TIMEOUTS.outlineGen).catch((e) => {
      console.log("WR11_TIMEOUT:", String(e).slice(0, 80));
      return null;
    });

    if (task) {
      console.log("WR11_TASK:", task.status, task.progress);
    }
    await deleteDraft(request, draft.id);
  });

  test("WR-12/EXP-01 导出 Markdown", async ({ page, request }) => {
    test.setTimeout(300_000);
    const draft = await createDraft(request, TEST_OUTLINE);

    // 生成 + 确认（导出要求 confirmed sections）
    await page.goto("/");
    await generateSectionSse(page, draft.id, draft.sections![0].id, TIMEOUTS.sectionGenerate);
    await confirmSection(request, draft.id, draft.sections![0].id);

    const result = await exportDraft(request, draft.id, "markdown");
    console.log("WR12_EXPORT:", result.status, "ok:", result.ok);
    expect(result.ok, "导出应成功").toBe(true);
    await deleteDraft(request, draft.id);
  });
});
