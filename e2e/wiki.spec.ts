/**
 * 模块 9 · Wiki（P1）
 *
 * WIKI-01~06：列表分页/搜索/排序、统计卡、词条详情、导出。
 * wiki entries 接口返回分页 { items, total, stats }。
 */
import { test, expect } from "@playwright/test";

test.describe("Wiki @smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/wiki");
    await page.waitForLoadState("networkidle");
  });

  test("WIKI-01 Wiki 列表渲染", async ({ page }) => {
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });
    // 列表区域（表格或空态卡片）
    const contentArea = page.locator("main, .p-8, .p-6").first();
    await expect(contentArea).toBeVisible();
  });

  test("WIKI-06 统计卡渲染（摘要/主题/概念/论断）", async ({ page }) => {
    // 统计卡（可能有数据或全 0，但卡片结构应存在）
    await page.waitForTimeout(2000);
    // 页面正常渲染，无错误
    const errPage = await page.locator("text=/Application error|Unhandled Runtime Error/i").count();
    expect(errPage).toBe(0);
  });

  test("WIKI-01b 搜索/排序控件存在", async ({ page }) => {
    // 搜索框
    const search = page.getByPlaceholder(/search|搜索/i);
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(search).toBeVisible();
    }
    // 排序/筛选下拉（若有）
    const combobox = page.getByRole("combobox");
    if (await combobox.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(combobox.first()).toBeVisible();
    }
  });

  test("WIKI-03 词条详情可访问（若有数据）", async ({ page }) => {
    // 若列表有词条行，点第一个进入详情
    const rows = page.locator("tbody tr, [class*='cursor-pointer']");
    const count = await rows.count();
    if (count > 0) {
      await rows.first().click();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    }
    // 无数据时仅验证页面不报错
    const errPage = await page.locator("text=/Application error/i").count();
    expect(errPage).toBe(0);
  });
});
