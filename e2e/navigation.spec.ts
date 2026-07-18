/**
 * 模块 2 · 全局导航与外壳（P0）
 *
 * 侧边栏 10 个入口可达、激活态、主题/语言切换、关于弹窗。
 * 探查确认：侧边栏链接 href 准确，html class 含 light/dark 表示主题。
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { userMenuTrigger } from "./helpers/selectors";

/**
 * Version shown in the About dialog is sourced from src/generated/app-version.ts
 * (the same constant the UI imports via @/lib/app-metadata). Reading it here
 * keeps the assertion in sync with whatever generate:meta last baked in,
 * instead of drifting like the old hardcoded `1.0.1` did.
 */
function readExpectedVersion(): string {
  const file = path.resolve(__dirname, "..", "src", "generated", "app-version.ts");
  const src = fs.readFileSync(file, "utf8");
  const m = /"version"\s*:\s*"([^"]+)"/.exec(src);
  if (!m) throw new Error(`could not parse version from ${file}`);
  return m[1];
}

const EXPECTED_VERSION = readExpectedVersion();

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

    // 版本号应与 src/generated/app-version.ts 一致（动态读取，避免再次漂移）
    await expect(
      dialog.locator(`text=${EXPECTED_VERSION}`),
    ).toBeVisible({ timeout: 5_000 });

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

  test("NAV-07 升级提醒按钮：发现新版本时在侧边栏出现并打开关于弹窗", async ({ page }) => {
    // 在普通浏览器中 isUpdateSupported() 为 false（无 window.synthetix.update），
    // 按钮默认不渲染。这里通过 addInitScript 注入一个 mock bridge，模拟
    // Electron 主进程推送 `available` 状态，验证：
    //   1. 按钮在侧边栏底部出现（且不破坏 NAV-01 的 `aside a` 计数=10，因为
    //      按钮是 <button> 而非 <a>）
    //   2. 点击后打开关于弹窗
    // 真实 Electron 行为（IPC、Toast 时机）由单元测试 + 手动验证覆盖。
    await page.addInitScript(() => {
      const listeners: Array<(s: unknown) => void> = [];
      const status = {
        kind: "available",
        path: "full",
        version: "9.9.9",
        sizeBytes: 100,
        forced: false,
      };
      (window as unknown as { synthetix: unknown }).synthetix = {
        update: {
          getStatus: async () => status,
          checkNow: async () => status,
          downloadAndInstall: async () => {},
          onProgress: (cb: (s: unknown) => void) => {
            listeners.push(cb);
            // Immediately push the available status so the provider's useEffect fires.
            setTimeout(() => cb(status), 50);
            return () => {
              const i = listeners.indexOf(cb);
              if (i >= 0) listeners.splice(i, 1);
            };
          },
        },
      };
    });

    await page.goto("/");

    // 按钮文案含目标版本 9.9.9（中文：发现新版本 v9.9.9）
    const reminderBtn = page.locator("aside button", {
      hasText: /9\.9\.9/,
    });
    await expect(reminderBtn).toBeVisible({ timeout: 10_000 });

    // 按钮没有破坏侧边栏链接计数（仍然是 10 个 <a>）
    await expect(page.locator("aside a")).toHaveCount(10);

    // 点击按钮应打开关于弹窗
    await reminderBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });
});
