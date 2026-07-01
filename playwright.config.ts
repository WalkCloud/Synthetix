import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E 配置 — Synthetix 浏览器端测试
 *
 * 测试方案见 docs/test-plan-browser-2026-06-29.md。
 * 用例通过标签区分冒烟（@smoke）与完整套件（@full）：
 *   pnpm e2e:smoke  → 仅冒烟
 *   pnpm e2e:full   → 仅完整套件
 *   pnpm e2e        → 全部
 *
 * 登录态：globalSetup 登录一次落盘 storageState，所有 spec 复用。
 */
const isCI = !!process.env.CI;
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/, // 仅匹配 spec 文件，排除 global-setup/teardown
  fullyParallel: false, // 真实 LLM + 共享 DB，避免并发互相污染
  forbidOnly: !!process.env.CI,
  retries: isCI ? 1 : 0,
  workers: 1, // 单 worker：真实环境状态有依赖，串行更稳
  globalSetup: require.resolve("./e2e/global-setup.ts"),
  globalTeardown: require.resolve("./e2e/global-teardown.ts"),
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e/.report", open: "never" }],
    ["json", { outputFile: "e2e/.report/results.json" }],
  ],
  timeout: 60_000, // 默认 60s；重型用例单独覆盖
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    storageState: "e2e/.auth/admin.json",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: undefined },
    },
  ],
});
