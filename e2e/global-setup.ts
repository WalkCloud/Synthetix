/**
 * Global Setup（config.globalSetup）— 登录 admin/Admin@123，落盘 storageState。
 * 后续所有 spec 复用登录态（config use.storageState 指向此文件）。
 *
 * 这是一个普通 async 函数，不是测试用例。
 */
import { chromium, expect, type FullConfig } from "@playwright/test";
import { ADMIN } from "./helpers/constants";

const AUTH_FILE = "e2e/.auth/admin.json";

export default async function globalSetup(_config: FullConfig) {
  const fs = await import("fs/promises");
  await fs.mkdir("e2e/.auth", { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    locale: "zh-CN",
  });
  const page = await context.newPage();

  await page.goto("/login");
  await page.locator("#username").waitFor({ state: "visible" });
  await page.locator("#username").fill(ADMIN.username);
  await page.locator("#password").fill(ADMIN.password);
  await page.locator('form button[type="submit"]').click();

  // 跳转仪表盘 + 侧边栏可见（验证登录成功）
  await page.waitForURL("/", { timeout: 30_000 });
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator('aside a[href="/library"]')).toBeVisible();

  // 落盘登录态
  await context.storageState({ path: AUTH_FILE });
  await browser.close();
}
