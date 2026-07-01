/**
 * 模块 14 · 非功能（P2）
 *
 * NF-02 控制台无未捕获错误：遍历主要页面，收集 console.error 与 pageerror。
 */
import { test, expect } from "@playwright/test";

const PAGES = [
  "/",
  "/documents",
  "/library",
  "/search",
  "/wiki",
  "/brainstorm",
  "/writing",
  "/models",
  "/settings",
];

test.describe("非功能 @smoke", () => {
  test("NF-02 各页面无未捕获的 JS 错误", async ({ page }) => {
    const errors: string[] = [];

    page.on("pageerror", (err) => {
      // 忽略已知噪声（如浏览器扩展、ResizeObserver）
      const msg = err.message;
      if (/ResizeObserver|extension|chrome-extension/i.test(msg)) return;
      errors.push(`pageerror: ${msg}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (/ResizeObserver|extension|favicon|chrome-extension/i.test(text)) return;
        // 忽略 401（未登录探测）等网络错误噪声
        if (/Failed to load resource|401|NetworkError/i.test(text)) return;
        errors.push(`console.error: ${text}`);
      }
    });

    for (const href of PAGES) {
      await page.goto(href);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500); // 给异步错误一点时间
    }

    // 允许少量噪声，但不应有实质性未捕获错误
    expect(errors, `捕获到错误:\n${errors.join("\n")}`).toHaveLength(0);
  });

  test("NF-01 网络异常时前端不白屏", async ({ page }) => {
    // 拦截某个 API 返回 500，确认页面仍渲染（不白屏）
    await page.route("**/api/v1/documents**", (route) =>
      route.fulfill({ status: 500, json: { success: false, error: "test" } }),
    );
    await page.goto("/library");
    await page.waitForLoadState("networkidle").catch(() => {});
    // 页面仍渲染（header 存在），不白屏
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });
  });
});
