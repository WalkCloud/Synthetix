/**
 * Capture ALL README screenshots (8 surfaces × 2 locales = 16 images):
 *   dashboard, library, search, wiki, brainstorm, writing, topology, models-usage
 *
 * For brainstorm / writing / models-usage, content is driven via API first
 * (brainstorm messages + section generation auto-populate token usage too).
 *
 * Usage: node scripts/capture-demo-screenshots.mjs
 * Prereq: app running on localhost:3000, e2e/.auth/admin.json present.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const AUTH = path.resolve("e2e/.auth/admin.json");
const OUT = path.resolve("docs/screenshots");
fs.mkdirSync(OUT, { recursive: true });

if (!fs.existsSync(AUTH)) {
  console.error("Missing e2e/.auth/admin.json — run the app and auth first.");
  process.exit(1);
}

const SESSION_TITLE = "容器云平台架构技术方案";

function makeApi(context) {
  return async (method, urlPath, body) => {
    const res = await context.request.fetch(`${BASE}${urlPath}`, {
      method,
      headers: { "content-type": "application/json" },
      data: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok()) {
      throw new Error(`${method} ${urlPath} ${res.status()}: ${text.slice(0, 300)}`);
    }
    return json;
  };
}

async function driveBrainstorm(api) {
  const created = await api("POST", "/api/v1/brainstorm/sessions", { title: SESSION_TITLE });
  const sessionId = created.data.id;
  console.log("brainstorm session:", sessionId);

  const messages = [
    "我想写一篇关于容器云平台架构的技术方案，目标读者是技术架构师和研发负责人，约8000字。",
    "重点覆盖多集群管理、服务网格、可观测性和安全合规这几个方向。",
    "确认这个方向，请帮我梳理一下整体结构。",
  ];
  for (const content of messages) {
    try {
      const r = await api("POST", `/api/v1/brainstorm/sessions/${sessionId}/message`, { content, phase: "gathering" });
      console.log("  msg marker:", r.data?.marker, "ai?", !!r.data?.message);
    } catch (e) {
      console.log("  msg failed:", e.message);
    }
  }
  return sessionId;
}

async function driveDraft(api, browser) {
  const outline = {
    title: SESSION_TITLE,
    sections: [
      { num: "1", title: "总体架构设计", description: "容器云平台的分层架构与核心组件职责。", keyPoints: ["控制平面与数据平面分离", "多集群联邦管理"], estimatedWords: 1200 },
      { num: "2", title: "多集群管理", description: "跨集群统一调度与容灾。", keyPoints: ["集群注册与发现", "统一权限模型"], estimatedWords: 1000 },
      { num: "3", title: "服务网格与流量治理", description: "基于 Istio 的东西向流量管理。", keyPoints: ["灰度发布", "熔断与限流"], estimatedWords: 1000 },
      { num: "4", title: "可观测性体系", description: "指标、日志、链路三支柱。", keyPoints: ["Prometheus 指标采集", "分布式追踪"], estimatedWords: 800 },
    ],
  };
  const created = await api("POST", "/api/v1/drafts", { outline });
  const draft = created.data;
  console.log("draft:", draft.id, "sections:", draft.sections?.length);

  // Generate first section via SSE inside a browser page (for cookies).
  const section = draft.sections[0];
  const ssePath = `/api/v1/drafts/${draft.id}/sections/${section.id}/generate`;
  console.log("generating section:", section.id, section.title);
  const ctx2 = await browser.newContext({ baseURL: BASE, storageState: AUTH });
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  try {
    const result = await page2.evaluate(async (p) => {
      const res = await fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) return { ok: false, status: res.status };
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let chunks = 0, gotDone = false, refs = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const txt = dec.decode(value, { stream: true });
        if (txt.includes('"type":"references"')) refs = true;
        if (txt.includes('"type":"chunk"') || txt.includes('"type":"delta"')) chunks++;
        if (txt.includes('"type":"done"')) gotDone = true;
      }
      return { ok: true, done: gotDone, chunks, refs };
    }, ssePath);
    console.log("  SSE:", JSON.stringify(result));
  } catch (e) {
    console.log("  SSE error (continuing):", e.message);
  }
  await ctx2.close();
  return draft.id;
}

/** Shoot a list of simple pages (navigate + screenshot, no interaction). */
async function shootSimple(page, clean, tag, sessionId) {
  const simple = [
    { name: "dashboard", url: "/", wait: 1000 },
    { name: "library", url: "/library", wait: 1000 },
    {
      name: "search",
      url: "/search",
      wait: 0,
      after: async (p) => {
        const input = p.getByPlaceholder(/Search documents|搜索|Search/i).first();
        await input.fill("精益创业").catch(() => {});
        await p.getByRole("button", { name: /Search|搜索/i }).last().click().catch(() => {});
        await p.waitForTimeout(1800);
      },
    },
    { name: "wiki", url: "/wiki", wait: 1200 },
    { name: "topology", url: "/topology", wait: 1500 },
  ];
  for (const s of simple) {
    try {
      await page.goto(`${BASE}${s.url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(s.wait);
      if (s.after) await s.after(page);
      await clean();
      const file = path.join(OUT, `${s.name}-${tag}.png`);
      await page.screenshot({ path: file });
      console.log(`OK ${s.name}-${tag}`);
    } catch (e) {
      console.log(`FAIL ${s.name}-${tag}:`, e.message);
    }
  }
}

/** Shoot interactive pages that need API-driven content. */
async function shootInteractive(page, clean, tag, sessionId, draftId) {
  // Brainstorm: open our session.
  try {
    await page.goto(`${BASE}/brainstorm`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const sessionItem = page.locator(`text=${SESSION_TITLE}`).first();
    if (await sessionItem.isVisible().catch(() => false)) {
      await sessionItem.click();
      await page.waitForTimeout(1500);
    }
    await clean();
    await page.screenshot({ path: path.join(OUT, `brainstorm-${tag}.png`) });
    console.log(`OK brainstorm-${tag}`);
  } catch (e) { console.log(`FAIL brainstorm-${tag}:`, e.message); }

  // Writing: open the draft with generated section.
  if (draftId) {
    try {
      await page.goto(`${BASE}/writing/${draftId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await clean();
      await page.screenshot({ path: path.join(OUT, `writing-${tag}.png`) });
      console.log(`OK writing-${tag}`);
    } catch (e) { console.log(`FAIL writing-${tag}:`, e.message); }
  }

  // Models usage.
  try {
    await page.goto(`${BASE}/models`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await clean();
    await page.screenshot({ path: path.join(OUT, `models-usage-${tag}.png`) });
    console.log(`OK models-usage-${tag}`);
  } catch (e) { console.log(`FAIL models-usage-${tag}:`, e.message); }
}

async function captureLocale(browser, locale, sessionId, draftId) {
  const tag = locale === "zh-CN" ? "zh" : "en";
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 1000 },
    storageState: AUTH,
  });
  await ctx.addInitScript((loc) => {
    localStorage.setItem("synthetix-locale", loc);
    document.cookie = `synthetix-locale=${loc}; path=/`;
  }, locale);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  async function clean() {
    await page.evaluate(() => {
      document.querySelectorAll('[aria-label="Open Next.js Dev Tools"], nextjs-portal, [data-nextjs-toast]').forEach((el) => el.remove());
    }).catch(() => {});
  }

  await shootSimple(page, clean, tag, sessionId);
  await shootInteractive(page, clean, tag, sessionId, draftId);
  await ctx.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ baseURL: BASE, storageState: AUTH });
  const api = makeApi(ctx);

  // Drive content once (data persists for both locale screenshots).
  let sessionId, draftId;
  try { sessionId = await driveBrainstorm(api); } catch (e) { console.log("brainstorm drive failed:", e.message); }
  try { draftId = await driveDraft(api, browser); } catch (e) { console.log("draft drive failed:", e.message); }
  console.log("state:", { sessionId, draftId });

  await ctx.close();

  await captureLocale(browser, "en", sessionId, draftId);
  await captureLocale(browser, "zh-CN", sessionId, draftId);

  await browser.close();
  console.log("DONE — 16 screenshots in docs/screenshots/");
}

main().catch((e) => { console.error(e); process.exit(1); });
