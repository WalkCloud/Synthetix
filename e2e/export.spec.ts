/**
 * 模块 8 · 导出（P1）
 *
 * EXP-01~03：Markdown / PDF / DOCX 导出。
 * 前置：section 需生成内容并 confirm（导出要求 confirmed sections）。
 */
import { test, expect } from "@playwright/test";
import {
  createDraft,
  deleteDraft,
  exportDraft,
  generateSectionSse,
  confirmSection,
  type Outline,
} from "./helpers/writing";

const TEST_OUTLINE: Outline = {
  title: "[E2E] 导出测试草稿",
  sections: [{ num: "1", title: "测试章节", description: "用于导出验证", estimatedWords: 300 }],
};

// 辅助：生成内容 + 确认节，返回 draftId
async function prepareConfirmedDraft(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  const draft = await createDraft(request, TEST_OUTLINE);
  await page.goto("/");
  await generateSectionSse(page, draft.id, draft.sections![0].id, 180_000);
  await confirmSection(request, draft.id, draft.sections![0].id);
  return draft;
}

test.describe("导出 @full", () => {
  test("EXP-01 导出 Markdown", async ({ page, request }) => {
    test.setTimeout(300_000);
    const draft = await prepareConfirmedDraft(page, request);

    const result = await exportDraft(request, draft.id, "markdown");
    console.log("EXP01_STATUS:", result.status, "len:", result.buffer?.length);
    expect(result.ok, "导出应成功").toBe(true);
    await deleteDraft(request, draft.id);
  });

  test("EXP-02 导出 PDF", async ({ page, request }) => {
    test.setTimeout(300_000);
    const draft = await prepareConfirmedDraft(page, request);

    const result = await exportDraft(request, draft.id, "pdf");
    console.log("EXP02_STATUS:", result.status, "CT:", result.contentType, "len:", result.buffer?.length);
    if (result.ok) {
      expect(result.buffer!.length, "PDF 应非空").toBeGreaterThan(0);
    }
    await deleteDraft(request, draft.id);
  });

  test("EXP-03 导出 DOCX", async ({ page, request }) => {
    test.setTimeout(300_000);
    const draft = await prepareConfirmedDraft(page, request);

    const result = await exportDraft(request, draft.id, "docx");
    console.log("EXP03_STATUS:", result.status, "len:", result.buffer?.length);
    if (result.ok) {
      expect(result.buffer!.length, "DOCX 应非空").toBeGreaterThan(0);
    }
    await deleteDraft(request, draft.id);
  });
});
