/**
 * 共享 UI 选择器与导航工具。
 * 导航统一用 href 定位（不依赖中英文文案），更稳定。
 */
import type { Page, Locator } from "@playwright/test";

/** 侧边栏导航链接（按 href 定位，与文案语言无关）。 */
export function navLink(page: Page, href: string): Locator {
  return page.locator(`aside a[href="${href}"]`);
}

/** 通过侧边栏导航到指定路由。 */
export async function gotoViaSidebar(page: Page, href: string): Promise<void> {
  // 根路径 href="/" 也会命中以 "/" 开头的其他项，需精确匹配
  if (href === "/") {
    await page.locator('aside a[href="/"]').first().click();
  } else {
    await navLink(page, href).click();
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** 用户菜单触发按钮（头像区）。 */
export function userMenuTrigger(page: Page): Locator {
  return page.locator("aside button").filter({ has: page.locator(".rounded-full") }).first();
}

/** 用户菜单内的按钮（按文案匹配，登录后展开）。 */
export function userMenuItem(page: Page, textPattern: RegExp | string): Locator {
  return page.locator("aside .bg-popover button", { hasText: textPattern });
}
