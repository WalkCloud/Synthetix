/**
 * 模块 1 · 鉴权与会话（P0）
 *
 * 登录成功用例由 global-setup 覆盖，这里覆盖其余鉴权场景。
 * 注意：这些用例需要无登录态，故用独立 context（不用全局 storageState）。
 */
import { test, expect } from "@playwright/test";

// 这些用例需要未登录态，禁用全局 storageState
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("鉴权与会话 @smoke", () => {
  test("AUTH-02 错误密码登录应停留在登录页", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("wrong-password-xxx");
    await page.locator('form button[type="submit"]').click();

    // 出现错误提示，仍停留在 /login
    await expect(page.locator(".text-destructive")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("AUTH-03 未登录访问受保护路由应重定向到 /login", async ({ page }) => {
    await page.goto("/library");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("AUTH-04 /setup 应重定向到 /login", async ({ page }) => {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("AUTH-05 登出后应回到登录页", async ({ page }) => {
    // 用正确凭证登录
    await page.goto("/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("ChangeMe@12345");
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL("/", { timeout: 30_000 });

    // 打开用户菜单并登出
    await page.locator("aside button").filter({ has: page.locator(".rounded-full") }).first().click();
    await page.getByRole("button", { name: /登出|退出|Logout|Sign out/i }).click();

    // 回到登录页
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
