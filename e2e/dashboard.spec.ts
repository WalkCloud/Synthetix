/**
 * 模块 3 · 仪表盘（P0）
 *
 * 统计卡片加载、快捷操作跳转、最近文档/草稿列表。
 * 断言结构可见性，不依赖具体数值（数据随环境变化）。
 */
import { test, expect } from "@playwright/test";

test.describe("仪表盘 @smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 等待数据加载完成（loading 状态消失）
    await page.waitForLoadState("networkidle");
  });

  test("DASH-01 四个统计卡片渲染", async ({ page }) => {
    // 统计卡片区（documents / drafts / tokens / activeTasks）
    const hero = page.locator(".bg-mesh");
    await expect(hero).toBeVisible();
    // 四个统计卡片（glass-card）
    const statCards = hero.locator(".glass-card");
    await expect(statCards).toHaveCount(4, { timeout: 15_000 });
    // 每个卡片应有数值文本（非空）
    const firstValue = await statCards.first().locator("span").first().textContent();
    expect(firstValue).not.toBeNull();
  });

  test("DASH-02 四个快捷操作跳转", async ({ page }) => {
    const quickActions = page.locator(".grid.grid-cols-4 > a");
    await expect(quickActions).toHaveCount(4);

    // 依次点击并验证跳转（上传文档 → /documents）
    const expectedHrefs = ["/documents", "/brainstorm", "/writing", "/library"];
    for (let i = 0; i < expectedHrefs.length; i++) {
      const href = await quickActions.nth(i).getAttribute("href");
      expect(href).toBe(expectedHrefs[i]);
    }
    // 点击第一个，确认跳转
    await quickActions.first().click();
    await expect(page).toHaveURL(/\/documents/, { timeout: 15_000 });
  });

  test("DASH-03 最近文档/草稿列表区域渲染", async ({ page }) => {
    // 两栏标题：最近文档 + 最近草稿（空态时含"暂无"文案）
    await expect(page.getByText(/最近文档|Recent Documents/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/最近草稿|Recent Drafts/i)).toBeVisible();
    // 列表卡片渲染（含空态或数据行）
    const cards = page.locator(".bg-card.border.rounded-2xl.shadow-soft");
    await expect(cards.first()).toBeVisible();
  });
});
