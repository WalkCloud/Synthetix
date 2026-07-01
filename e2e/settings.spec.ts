/**
 * 模块 12 · 用户与系统设置（P1）
 *
 * 探查确认：ProfileTab 的 label/input 无 htmlFor 关联，需结构定位。
 * labels：用户名(disabled)/显示名称/邮箱/简介。
 * SET-03 改密码用例默认跳过（有还原风险），需显式 --grep 才跑。
 */
import { test, expect } from "@playwright/test";

test.describe("用户与系统设置 @smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
  });

  test("SET-01/04 设置页渲染（资料表单 + 5 Tab）", async ({ page }) => {
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });
    // 5 个 Tab（资料/密码/存储/数据库/RAG）
    const tabBtns = page.locator(".flex.gap-0.border-b button");
    await expect(tabBtns).toHaveCount(5, { timeout: 10_000 });
    // 资料字段标签存在
    await expect(page.locator("label", { hasText: /用户名|Username/i })).toBeVisible();
    await expect(page.locator("label", { hasText: /显示名称|Display/i })).toBeVisible();
    await expect(page.locator("label", { hasText: /邮箱|Email/i })).toBeVisible();
  });

  test("SET-01b 修改显示名（best-effort 持久化）", async ({ page }) => {
    // 定位"显示名称" label 所在 div 的下一个 input（结构：label + input 同级）
    const displayLabel = page.locator("label", { hasText: /显示名称|Display/i });
    await expect(displayLabel).toBeVisible({ timeout: 10_000 });
    // label 的父级 div 内、label 之后的 input
    const displayNameField = displayLabel.locator("xpath=following::input[1]");

    const original = await displayNameField.inputValue();
    const testValue = original.includes("[E2E]")
      ? original.replace(" [E2E]", "")
      : original + " [E2E]";
    await displayNameField.fill(testValue);

    // 保存按钮
    const saveBtn = page.getByRole("button", { name: /保存|更新|Save|Update/i }).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }
    // 无错误页
    const errPage = await page.locator("text=/Application error|Unhandled Runtime Error/i").count();
    expect(errPage).toBe(0);
  });

  test("SET-04b 各设置 Tab 可切换", async ({ page }) => {
    const tabBtns = page.locator(".flex.gap-0.border-b button");
    const count = await tabBtns.count();
    for (let i = 0; i < count; i++) {
      await tabBtns.nth(i).click();
      await page.waitForTimeout(1000);
      const errPage = await page.locator("text=/Application error|Unhandled Runtime Error/i").count();
      expect(errPage).toBe(0);
    }
  });
});
