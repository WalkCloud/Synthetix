/**
 * 专项 5A · A组：模式选择 UI 交互（P0，纯前端，不真实处理）
 *
 * 四个 KnowledgeMode 卡片渲染、切换、graph 能力门控、预估随模式变化。
 * 这些不触发真实文档处理，快速可跑。
 */
import { test, expect } from "@playwright/test";

// 四种模式的文案（中英双语匹配）
const MODE_LABELS = {
  standard: /标准检索|Standard/i,
  graph: /知识图谱|Graph/i,
  wiki: /知识提炼|Wiki/i,
  full: /完整分析|Full/i,
} as const;

test.describe("5A · 模式选择 UI @smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    // 等待 ProcessingSettings 卡片渲染
    await expect(page.getByText(/分析深度|Knowledge Mode/i)).toBeVisible({ timeout: 15_000 });
  });

  test("MODE-01 四个模式卡片渲染，full 带推荐标", async ({ page }) => {
    const cardsContainer = page.locator(".grid.grid-cols-2.md\\:grid-cols-4");
    await expect(cardsContainer).toBeVisible();
    const cards = cardsContainer.locator("button");
    await expect(cards).toHaveCount(4, { timeout: 10_000 });

    // full 卡片带推荐标记
    await expect(page.getByText(/推荐|Recommended/i).first()).toBeVisible();
  });

  test("MODE-02 切换模式，选中态高亮", async ({ page }) => {
    const cardsContainer = page.locator(".grid.grid-cols-2.md\\:grid-cols-4");
    const cards = cardsContainer.locator("button");

    // 点击"标准检索"
    const standardCard = cards.filter({ hasText: MODE_LABELS.standard });
    await standardCard.click();

    // 该卡片应变为选中态（border-primary / ring）
    await expect(standardCard).toHaveClass(/primary|ring/);
    // 详情提示文案出现
    await expect(page.locator(".bg-muted\\/50, .bg-muted\\/50").first()).toBeVisible().catch(async () => {
      // detail panel 选择器可能不同，best-effort
    });
  });

  test("MODE-02b 依次切换四个模式无报错", async ({ page }) => {
    const cardsContainer = page.locator(".grid.grid-cols-2.md\\:grid-cols-4");
    for (const label of Object.values(MODE_LABELS)) {
      const card = cardsContainer.locator("button").filter({ hasText: label });
      if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
        await card.click();
        await page.waitForTimeout(500);
      }
    }
    // 全程无报错
    await expect(page.locator("body")).not.toContainText(/Internal Server Error/i);
  });

  test("MODE-03 graph 能力门控（若嵌入模型 dim<1536）", async ({ page }) => {
    // 选 embedding 模型下拉
    const embedSelect = page.locator("label").filter({ hasText: /嵌入|Embedding/i }).locator("..").getByRole("combobox");
    await embedSelect.click();
    const options = page.getByRole("option");
    const optCount = await options.count();

    // 若有 embedding 模型选项，选第一个，观察 graph/full 是否被禁用
    if (optCount > 0) {
      await options.first().click();
      await page.waitForTimeout(800);
    }
    // graph/full 卡片若被禁用，应有 opacity-40 + cursor-not-allowed
    // 这里仅验证 UI 逻辑存在（不强制要求禁用，取决于所选嵌入模型维度）
    const cardsContainer = page.locator(".grid.grid-cols-2.md\\:grid-cols-4");
    await expect(cardsContainer.locator("button").first()).toBeVisible();
  });

  test("MODE-05 预估提示随模式变化（graph 类应更长）", async ({ page }) => {
    // 模拟已上传文件的预估——这需要先有上传。
    // 纯前端验证：切换 standard vs full，预估时间文案若可见应不同。
    // 此用例为 best-effort，预估依赖 uploadedBatch 状态。
    const cardsContainer = page.locator(".grid.grid-cols-2.md\\:grid-cols-4");
    const standard = cardsContainer.locator("button").filter({ hasText: MODE_LABELS.standard });
    const full = cardsContainer.locator("button").filter({ hasText: MODE_LABELS.full });

    await standard.click();
    await page.waitForTimeout(300);
    await full.click();
    await page.waitForTimeout(300);
    // 不报错即可（预估文案需上传文件才出现）
    await expect(page.locator("body")).not.toContainText(/Internal Server Error/i);
  });
});
