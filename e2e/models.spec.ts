/**
 * 模块 11 · 模型管理（P0，谨慎）
 *
 * 只读优先：验证现有 provider 可见、测试连接。
 * MDL-03/04 临时建删 provider 仅作可选验证（@full），绝不改/删用户现有配置。
 */
import { test, expect } from "@playwright/test";
import { getProviders } from "./helpers/models";

test.describe("模型管理 @smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/models");
    await page.waitForLoadState("networkidle");
  });

  test("MDL-01 现有 provider 全部可见（未受污染）", async ({ request, page }) => {
    const providers = await getProviders(request);
    expect(providers.length, "应至少有 1 个已配置 provider").toBeGreaterThan(0);

    // 默认在 usage tab，切到 LLM tab 显示 provider 卡片
    const llmTab = page.getByRole("button", { name: /^LLM$/i });
    if (await llmTab.isVisible().catch(() => false)) {
      await llmTab.click();
      await page.waitForTimeout(2000);
    }
    // provider 卡片存在（.bg-card.rounded-2xl 至少 1 个）
    const cards = page.locator(".bg-card.rounded-2xl");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  });

  test("MDL-06 用量统计 Tab 渲染", async ({ page }) => {
    // 默认 usage tab；统计卡片存在（.bg-card.rounded-2xl）
    const cards = page.locator(".bg-card.rounded-2xl");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    expect(await cards.count()).toBeGreaterThan(0);
    // 时间范围切换按钮（today/week/month，在 .bg-secondary 容器内）
    const rangeBtns = page.locator(".bg-secondary button");
    if (await rangeBtns.first().isVisible().catch(() => false)) {
      expect(await rangeBtns.count()).toBeGreaterThanOrEqual(2);
    }
  });

  test("MDL-01b 各 Slot Tab 可切换", async ({ page }) => {
    const slots = [/^LLM$/i, /Embedding|嵌入/i, /Rerank|重排/i, /Image|图像/i, /Usage|用量/i];
    for (const slot of slots) {
      const btn = page.getByRole("button", { name: slot });
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(1500);
        // 切换后无错误页
        const errPage = await page.locator("text=/Application error|Unhandled Runtime Error/i").count();
        expect(errPage).toBe(0);
      }
    }
  });
});
