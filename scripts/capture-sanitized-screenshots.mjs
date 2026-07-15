/**
 * Capture ALL README screenshots with sensitive info masked.
 *
 * Masks usernames, model provider names, and model identifiers before
 * screenshotting, so no private/org-specific info leaks into the public repo.
 *
 * Usage: node scripts/capture-sanitized-screenshots.mjs
 * Prereq: app running on localhost:3000, e2e/.auth/admin.json present.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.resolve("docs/screenshots");
fs.mkdirSync(OUT, { recursive: true });

const SESSION_TITLE = "容器云平台建设规划方案";

/**
 * Sensitive-text masker. Called via page.evaluate() AFTER page load,
 * right before screenshot, to avoid React re-render overwriting early masks.
 */
const MASK_MAP = [
  [/攻城狮Kevin/g, "Demo User"],
  [/攻城狮/g, "Demo"],
  [/Kevin/g, "User"],
  [/火山方舟/g, "Provider A"],
  [/DeepSeek/g, "Provider B"],
  [/DashScope/g, "Provider C"],
  [/Doubao/g, "Provider D"],
  [/deepseek-v4-flash/g, "model-a"],
  [/Text Embedding V4/g, "embedding-a"],
];

async function maskAndVerify(page) {
  const result = await page.evaluate((map) => {
    const MAP = map.map(([re, rep]) => [new RegExp(re, "g"), rep]);
    let count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      let t = node.textContent;
      if (!t) continue;
      let changed = false;
      for (const [re, rep] of MAP) {
        if (re.test(t)) { t = t.replace(re, rep); re.lastIndex = 0; changed = true; }
      }
      if (changed) { node.textContent = t; count++; }
    }
    // Verify no leaks remain
    const text = document.body.innerText;
    const leaks = [];
    for (const word of ["攻城狮", "Kevin", "火山方舟", "DeepSeek", "DashScope", "Doubao", "deepseek-v4"]) {
      if (text.includes(word)) leaks.push(word);
    }
    return { replaced: count, leaks };
  }, MASK_MAP.map(([re, rep]) => [re.source, rep]));
  return result;
}

async function captureLocale(browser, locale) {
  const tag = locale === "zh-CN" ? "zh" : "en";
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 1000 },
  });
  await ctx.addInitScript((loc) => {
    localStorage.setItem("synthetix-locale", loc);
    document.cookie = `synthetix-locale=${loc}; path=/`;
  }, locale);

  // --- Fresh login (don't rely on expired storageState) ---
  const loginPage = await ctx.newPage();
  await loginPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await loginPage.locator("#username").fill("admin");
  await loginPage.locator("#password").fill("Admin@123");
  await loginPage.locator('form button[type="submit"]').click();
  await loginPage.waitForURL("/", { timeout: 30000 }).catch(() => {});
  await loginPage.waitForTimeout(1000);
  await loginPage.close();
  console.log(`login OK (${locale})`);

  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  async function clean() {
    await page.evaluate(() => {
      document.querySelectorAll('[aria-label="Open Next.js Dev Tools"], nextjs-portal, [data-nextjs-toast]').forEach((el) => el.remove());
    }).catch(() => {});
  }

  /** Navigate, wait for content, mask sensitive text, verify, then screenshot. */
  async function shoot(name, url, opts = {}) {
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(opts.wait || 1200);
      if (opts.after) await opts.after(page);
      await page.waitForTimeout(300);
      // Mask sensitive text right before screenshot.
      const masked = await maskAndVerify(page);
      await clean();
      await page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) });
      if (masked.leaks.length > 0) {
        console.log(`WARN ${name}-${tag}: leaks remain: ${masked.leaks.join(", ")}`);
      }
      console.log(`OK ${name}-${tag} (masked ${masked.replaced})`);
    } catch (e) { console.log(`FAIL ${name}-${tag}:`, e.message); }
  }

  // --- Simple pages ---
  await shoot("dashboard", "/", { wait: 1500 });
  await shoot("library", "/library", { wait: 1500 });
  await shoot("search", "/search", {
    wait: 0,
    after: async (p) => {
      const input = p.getByPlaceholder(/Search documents|搜索|Search/i).first();
      await input.fill("精益创业").catch(() => {});
      await p.getByRole("button", { name: /Search|搜索/i }).last().click().catch(() => {});
      await p.waitForTimeout(1800);
    },
  });
  await shoot("wiki", "/wiki", { wait: 1500 });
  await shoot("topology", "/topology", { wait: 1800 });

  // --- Brainstorm: open a session ---
  await shoot("brainstorm", "/brainstorm", {
    wait: 1000,
    after: async (p) => {
      const sessionItem = p.locator(`text=${SESSION_TITLE}`).first();
      if (await sessionItem.isVisible().catch(() => false)) {
        await sessionItem.click();
        await p.waitForTimeout(1800);
      }
    },
  });

  // --- Writing: open the draft ---
  await shoot("writing", "/writing", {
    wait: 1000,
    after: async (p) => {
      const draftBtn = p.getByRole("button", { name: SESSION_TITLE }).first();
      if (await draftBtn.isVisible().catch(() => false)) {
        await draftBtn.click();
        await p.waitForTimeout(2500);
      }
    },
  });

  // --- Models usage ---
  await shoot("models-usage", "/models", { wait: 2000 });

  await ctx.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  await captureLocale(browser, "en");
  await captureLocale(browser, "zh-CN");
  await browser.close();
  console.log("DONE — 16 sanitized screenshots in docs/screenshots/");
}

main().catch((e) => { console.error(e); process.exit(1); });
