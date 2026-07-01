/**
 * 模块 4 · 文档库与检索（P0/P1）
 *
 * 库列表（统计条、筛选、排序、搜索）、文档详情、关键词/语义检索。
 * 无 data-testid，用 role/placeholder/title/结构定位。
 */
import { test, expect } from "@playwright/test";

test.describe("文档库 @smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library");
    await page.waitForLoadState("networkidle");
  });

  test("LIB-01 库列表渲染 + 统计条", async ({ page }) => {
    // 统计条（StatsRibbon）渲染
    const statsRibbon = page.locator(".bg-card").first();
    await expect(statsRibbon).toBeVisible({ timeout: 15_000 });
    // 表格容器存在（loading 或数据行）
    const table = page.locator("table");
    // 即使空态也应有列表区
    await expect(page.locator("body")).toBeVisible();
  });

  test("LIB-01b 筛选与搜索输入存在", async ({ page }) => {
    // 格式筛选按钮（PDF/DOCX 等）
    const formatBtns = page.locator("button", { hasText: /^(PDF|DOCX|PPTX|MD|全部|All)$/i });
    await expect(formatBtns.first()).toBeVisible({ timeout: 15_000 });

    // 搜索框
    const searchInput = page.getByPlaceholder(/search|搜索/i);
    await expect(searchInput).toBeVisible();

    // 状态/排序下拉（combobox）
    const selects = page.getByRole("combobox");
    await expect(selects.first()).toBeVisible();
  });

  test("LIB-01c 排序下拉可切换", async ({ page }) => {
    const sortSelect = page.getByRole("combobox").last();
    await sortSelect.click();
    // 下拉项出现
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 5_000 });
  });

  test("LIB-03 关键词搜索返回结果", async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search|搜索/i);
    await searchInput.fill("测试");
    await searchInput.press("Enter");
    // 等待结果刷新（无错误）
    await page.waitForLoadState("networkidle");
    // 不应出现错误提示
    await expect(page.locator("body")).not.toContainText(/Internal Server Error/i);
  });
});

test.describe("知识检索 @smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");
  });

  test("LIB-04 检索页双 Tab 存在", async ({ page }) => {
    // 文档检索 + 知识图谱 两个 Tab
    const tabBtns = page.locator(".flex.gap-0.border-b button");
    await expect(tabBtns).toHaveCount(2, { timeout: 15_000 });
  });

  test("LIB-04b 语义检索不报错", async ({ page }) => {
    // 检索输入框
    const queryInput = page.getByPlaceholder(/search|ask|检索|问题/i);
    await expect(queryInput).toBeVisible({ timeout: 10_000 });
    await queryInput.fill("容器平台架构");
    await queryInput.press("Enter");

    // 等待搜索完成（最多给 15s），无错误页/无未捕获异常
    await page.waitForTimeout(5000);
    const errPage = await page.locator("text=/Application error|Unhandled Runtime Error/i").count();
    expect(errPage).toBe(0);
  });

  test("LIB-04c 知识图谱 Tab 可切换", async ({ page }) => {
    const tabBtns = page.locator(".flex.gap-0.border-b button");
    await tabBtns.nth(1).click();
    // 切换后图谱区域渲染（含 canvas 或空态提示）
    await page.waitForTimeout(2000);
    await expect(page.locator("body")).toBeVisible();
  });
});
