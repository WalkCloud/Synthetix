/**
 * 模块 10 · 知识图谱与拓扑（P1）
 *
 * KG-01~04：知识图谱加载、交互、拓扑图、实体证据。
 * 知识图谱用 d3-force 渲染（SVG/canvas），拓扑图需选 draft。
 */
import { test, expect } from "@playwright/test";

test.describe("知识图谱与拓扑 @smoke", () => {
  test("KG-01 知识图谱页加载（检索页知识图谱 Tab）", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");
    // 切到知识图谱 Tab
    const tabs = page.locator(".flex.gap-0.border-b button");
    if ((await tabs.count()) >= 2) {
      await tabs.nth(1).click();
      await page.waitForTimeout(2000);
    }
    // 页面渲染（图谱 canvas 或空态提示）
    await expect(page.locator("body")).toBeVisible();
    const errPage = await page.locator("text=/Application error/i").count();
    expect(errPage).toBe(0);
  });

  test("KG-03 拓扑图页面渲染", async ({ page }) => {
    await page.goto("/topology");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });
    // 拓扑页需选 draft，渲染选择区或画布
    const errPage = await page.locator("text=/Application error/i").count();
    expect(errPage).toBe(0);
  });

  test("KG-04 实体证据 API 可访问", async ({ request }) => {
    // 知识实体接口可调用（即使空也返回成功）
    const res = await request.get("/api/v1/knowledge/entities");
    const body = await res.json();
    expect(body.success).toBe(true);
    // health 接口
    const healthRes = await request.get("/api/v1/knowledge/health");
    const healthBody = await healthRes.json();
    expect(healthBody.success).toBe(true);
  });
});
