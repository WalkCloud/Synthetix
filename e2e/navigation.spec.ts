/**
 * 模块 2 · 全局导航与外壳（P0）
 *
 * 侧边栏 10 个入口可达、激活态、主题/语言切换、关于弹窗。
 * 探查确认：侧边栏链接 href 准确，html class 含 light/dark 表示主题。
 */
import { test, expect } from "@playwright/test";
import { userMenuTrigger } from "./helpers/selectors";

const NAV_ENTRIES = [
  "/",
  "/documents",
  "/library",
  "/search",
  "/wiki",
  "/brainstorm",
  "/writing",
  "/topology",
  "/models",
  "/settings",
] as const;

test.describe("全局导航 @smoke", () => {
  test("NAV-01 侧边栏 10 个入口依次可达", async ({ page }) => {
    // 先确认侧边栏链接数量与 href
    await page.goto("/");
    await expect(page.locator("aside a")).toHaveCount(10, { timeout: 15_000 });

    // 直接导航每个路由（比侧边栏点击更稳，避免 networkidle 竞态）
    for (const href of NAV_ENTRIES) {
      await page.goto(href);
      // 每个路由 header 渲染即视为可达（不依赖 networkidle）
      await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });
      // 不应是 Next.js 错误页（特征：仅含错误堆栈，无 header）
      const hasErrorPage = await page.locator("text=/Application error|Unhandled Runtime Error/i").count();
      expect(hasErrorPage).toBe(0);
    }
  });

  test("NAV-01b 侧边栏链接 href 正确", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator("aside a").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href")),
    );
    expect(hrefs).toEqual([...NAV_ENTRIES]);
  });

  test("NAV-02 激活态高亮", async ({ page }) => {
    await page.goto("/library");
    // 当前项应带激活样式（font-semibold + primary）
    const libLink = page.locator('aside a[href="/library"]');
    await expect(libLink).toBeVisible({ timeout: 10_000 });
    await expect(libLink).toHaveClass(/font-semibold|primary/);
  });

  test("NAV-03 深色/浅色主题切换", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    const htmlClass = (await page.locator("html").getAttribute("class")) ?? "";
    const isDarkBefore = htmlClass.includes("dark");

    await userMenuTrigger(page).click();
    // 主题按钮文案：当前 dark 时显示"浅色/Light"，反之"深色/Dark"
    const themeBtn = page.locator("aside .bg-popover button").filter({
      hasText: isDarkBefore ? /浅色|Light/i : /深色|Dark/i,
    });
    await themeBtn.click();

    // html class 的 dark 应翻转
    await expect.poll(
      async () => {
        const cls = (await page.locator("html").getAttribute("class")) ?? "";
        return cls.includes("dark");
      },
      { timeout: 10_000 },
    ).toBe(!isDarkBefore);
  });

  test("NAV-04 中英文切换", async ({ page }) => {
    await page.goto("/");
    await userMenuTrigger(page).click();
    await page.locator("aside .bg-popover button", { hasText: /语言|Language/i }).click();

    // 语言子菜单
    const langButtons = page.locator("aside .bg-popover .bg-popover button");
    await expect(langButtons.first()).toBeVisible({ timeout: 5_000 });
    const count = await langButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
    await langButtons.first().click();
    // 切换后页面仍正常
    await expect(page.locator("aside")).toBeVisible();
  });

  test("NAV-05 关于弹窗可打开并显示版本与许可证入口", async ({ page }) => {
    await page.goto("/");
    await userMenuTrigger(page).click();
    await page.locator("aside .bg-popover button", { hasText: /关于|About/i }).click();

    // 弹窗：base-ui dialog，role=dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // 版本号应与 package.json 一致（不再硬编码 0.5.3.0）
    await expect(dialog.locator("text=1.0.1")).toBeVisible({ timeout: 5_000 });

    // 许可证入口（Apache-2.0 友好文案 + 第三方声明按钮）可见
    await expect(dialog.locator("a", { hasText: /License|许可证/i })).toBeVisible();
    await expect(
      dialog.locator("button", { hasText: /Third-party|第三方开源声明/i }),
    ).toBeVisible();
  });

  test("NAV-06 第三方开源声明页面可达", async ({ page }) => {
    await page.goto("/legal/third-party-notices");
    // 页面标题渲染（无 sidebar 的独立路由）
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });
    const heading = await page.locator("h1").textContent();
    expect(heading).toMatch(/Third-party|第三方开源声明/);
  });
});
