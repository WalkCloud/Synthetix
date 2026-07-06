/**
 * Screenshot verification driver — uses REAL Chrome (Playwright) to capture
 * page-level evidence at every phase of the cycle.
 *
 * This addresses the verifier's gap: previous cycles validated via API only.
 * This script captures actual page screenshots proving:
 *   1. /library empty state after delete (no docs shown)
 *   2. /search knowledge graph tab empty (no nodes)
 *   3. /library/wiki entries page empty
 *   4. Document detail page with pipeline progress bar UI
 *   5. /search graph tab with nodes after processing
 *
 * Flow: delete all → screenshot empty states → upload 3 docs → screenshot
 * pipeline progress → wait for graph → screenshot graph populated → brainstorm
 * → outline → write 2 sections → screenshot writing page.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const AUTH_FILE = "e2e/.auth/admin.json";
const SHOTS = "e2e/.screenshots";
const USER_TEST_DIR = "E:/test doc";

function log(m) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`); }

async function shot(page, name, opts) {
  const fp = path.join(SHOTS, name);
  await page.screenshot({ path: fp, fullPage: opts?.fullPage ?? false, ...(opts||{}) });
  log(`📸 ${name}`);
}

function resolveTestDocs() {
  const files = fs.readdirSync(USER_TEST_DIR);
  return [".epub", ".docx", ".pdf"].map((ext) => {
    const m = files.find((f) => f.toLowerCase().endsWith(ext));
    return m ? { path: path.join(USER_TEST_DIR, m), format: ext.slice(1), name: m } : null;
  }).filter(Boolean);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ baseURL: BASE, locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  if (fs.existsSync(AUTH_FILE)) {
    const a = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (a.cookies) await ctx.addCookies(a.cookies);
  }
  const page = await ctx.newPage();

  // ═══ PHASE A: Delete all docs + screenshot empty states ═══════════════
  log("=== PHASE A: Delete all docs + verify clean via page screenshots ===");
  await page.goto("/library");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  // Get current docs and delete via the page's delete flow (not force-kill)
  const docs = await page.evaluate(async () => {
    const r = await fetch("/api/v1/library/documents");
    return (await r.json()).data || [];
  });
  log(`Found ${docs.length} docs to delete`);
  for (const d of docs) {
    // Delete via API (triggers cleanup task), then wait for it
    await page.evaluate(async (id) => {
      await fetch(`/api/v1/documents/${id}?deleteWiki=true`, { method: "DELETE" });
    }, d.id);
    log(`  Deleted ${d.id.slice(0, 8)} (${d.originalName?.slice(0, 30)})`);
  }

  // Wait for cleanup tasks to complete (poll)
  log("Waiting for cleanup tasks...");
  const cleanupDeadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < cleanupDeadline) {
    const tasks = await page.evaluate(async () => {
      const r = await fetch("/api/v1/tasks?limit=10");
      return (await r.json()).data || [];
    });
    const activeCleanups = tasks.filter((t) => t.type === "document_cleanup" && (t.status === "pending" || t.status === "running"));
    if (activeCleanups.length === 0) { log("All cleanup tasks done"); break; }
    log(`  ${activeCleanups.length} cleanup tasks still active...`);
    await page.waitForTimeout(15000);
  }
  await page.waitForTimeout(5000); // extra settle for cache invalidation

  // Screenshot 1: /library empty state
  await page.goto("/library");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await shot(page, "02-library-empty-after-delete.png", { fullPage: true });

  // Verify via API
  const remaining = await page.evaluate(async () => {
    const r = await fetch("/api/v1/library/documents");
    return (await r.json()).data || [];
  });
  log(`Library after delete: ${remaining.length} docs`);

  // Screenshot 2: /search knowledge graph tab (empty)
  await page.goto("/search");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  // Click the "Knowledge Graph" tab (second tab)
  const graphTab = page.locator(".flex.gap-0.border-b button").nth(1);
  if (await graphTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await graphTab.click();
    await page.waitForTimeout(3000);
  }
  await shot(page, "03-search-graph-empty.png", { fullPage: true });

  // Screenshot 3: /wiki page (empty)
  await page.goto("/wiki");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await shot(page, "04-wiki-empty.png", { fullPage: true });

  // ═══ PHASE B: Upload 3 docs + screenshot pipeline progress ════════════
  log("=== PHASE B: Upload 3 docs + screenshot pipeline ===");
  const testDocs = resolveTestDocs();
  await page.goto("/documents");
  await page.waitForLoadState("networkidle");
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: "attached", timeout: 15000 });

  // Select graph mode
  const graphModeBtn = page.locator("button, [role='radio'], label").filter({ hasText: /graph|图谱|知识图谱/i }).first();
  if (await graphModeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await graphModeBtn.click();
    log("Selected graph mode");
  }

  // Upload all 3
  await fileInput.setInputFiles(testDocs.map((d) => d.path));
  await page.waitForTimeout(5000);

  // Capture the upload page state
  await shot(page, "05-upload-complete.png", { fullPage: true });

  // Click Start Processing
  const startBtn = page.locator("button").filter({ hasText: /start processing|开始处理|处理|开始/i }).first();
  if (await startBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
    await startBtn.click();
    log("Clicked Start Processing");
    await page.waitForURL(/\/library/, { timeout: 30000 }).catch(() => {});
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  // Get docIds
  const uploaded = await page.evaluate(async () => {
    const r = await fetch("/api/v1/library/documents?status=pending");
    const d1 = (await r.json()).data || [];
    const r2 = await fetch("/api/v1/library/documents");
    const d2 = (await r2.json()).data || [];
    // Merge, dedupe
    const map = new Map();
    for (const d of [...d1, ...d2]) map.set(d.id, d);
    return [...map.values()];
  });
  log(`Uploaded ${uploaded.length} docs`);
  if (uploaded.length < 3) {
    // Try queued status
    const queued = await page.evaluate(async () => {
      const r = await fetch("/api/v1/library/documents?status=queued");
      return (await r.json()).data || [];
    });
    uploaded.push(...queued);
  }
  const docIds = uploaded.map((d) => d.id);
  log(`Doc IDs: ${docIds.map((id) => id.slice(0, 8)).join(", ")}`);

  // Screenshot /library with processing docs
  await page.goto("/library");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  await shot(page, "06-library-processing.png", { fullPage: true });

  // Screenshot document detail page with pipeline progress
  if (docIds.length > 0) {
    await page.goto(`/library/${docIds[0]}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
    await shot(page, "07-doc-detail-pipeline.png", { fullPage: true });
    log(`Doc detail screenshot for ${docIds[0].slice(0, 8)}`);
  }

  // ═══ PHASE C: Wait for graph completion (long) ════════════════════════
  log("=== PHASE C: Waiting for graph completion ===");
  const graphStart = Date.now();
  const graphDeadline = Date.now() + 4 * 60 * 60 * 1000;
  let lastState = "";
  while (Date.now() < graphDeadline) {
    const states = {};
    let doneCount = 0;
    let failedCount = 0;
    for (const id of docIds) {
      const detail = await page.evaluate(async (docId) => {
        const r = await fetch(`/api/v1/library/documents/${docId}`);
        return (await r.json()).data;
      }, id);
      const ds = detail?.displayStatus || "?";
      const gb = ((detail?.pipeline?.branches) || []).find((b) => b.key === "stageGraph");
      const gs = gb?.status || "?";
      states[id.slice(0, 8)] = { ds, gs, gp: gb?.progress || 0 };
      if (gs === "done" || ds === "ready") doneCount++;
      if (ds === "failed") failedCount++;
    }
    const stateKey = JSON.stringify(states);
    const min = Math.floor((Date.now() - graphStart) / 60000);
    if (stateKey !== lastState) {
      const summary = Object.entries(states).map(([k, v]) => `${k}:${v.ds}/g${v.gs}(${v.gp}%)`).join(" ");
      log(`[${min}m] ${summary}`);
      lastState = stateKey;
    }
    // Done when all docs are ready AND no active graph tasks
    const activeGraphs = await page.evaluate(async () => {
      const r = await fetch("/api/v1/tasks?type=rag_index&limit=5");
      return (await r.json()).data || [];
    });
    const stillRunning = activeGraphs.filter((t) => t.status === "running" || t.status === "pending");
    if (doneCount >= docIds.length && stillRunning.length === 0) {
      log(`All docs processed at ${min}m (${doneCount} ready, ${failedCount} failed)`);
      break;
    }
    // Also break if all graphs are terminal
    const allTerminal = activeGraphs.length > 0 && activeGraphs.every((t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled");
    if (allTerminal && doneCount + failedCount >= docIds.length) {
      log(`All graphs terminal at ${min}m`);
      break;
    }
    await page.waitForTimeout(120000); // poll every 2 min
  }

  // Screenshot /search graph tab with nodes (after processing)
  await page.goto("/search");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  const graphTab2 = page.locator(".flex.gap-0.border-b button").nth(1);
  if (await graphTab2.isVisible({ timeout: 5000 }).catch(() => false)) {
    await graphTab2.click();
    await page.waitForTimeout(5000);
  }
  await shot(page, "08-search-graph-populated.png", { fullPage: true });

  // Screenshot /wiki with entries
  await page.goto("/wiki");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await shot(page, "09-wiki-populated.png", { fullPage: true });

  // ═══ PHASE D: Brainstorm + Outline + Write 2 sections ═════════════════
  log("=== PHASE D: Brainstorm → Outline → Write 2 sections ===");
  await page.goto("/brainstorm");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await shot(page, "10-brainstorm-start.png", { fullPage: true });

  // Start conversation
  const startConv = page.locator("button").filter({ hasText: /start conversation|开始对话|开始/i }).first();
  await startConv.waitFor({ state: "visible", timeout: 15000 });
  await startConv.click();
  await page.waitForTimeout(3000);

  const sessResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions`);
  const sessBody = await sessResp.json();
  const sessionId = (sessBody.data || [])[0]?.id;
  log(`Session: ${sessionId}`);

  // Send 3 messages
  const msgs = [
    "我想写一份关于容器云平台架构设计的技术报告，面向企业架构师。",
    "篇幅约 8000 字，覆盖架构设计、技术选型、实施路径三大模块。",
    "方向：聚焦中型企业(50-200人)的容器云落地实践，强调可操作性。",
  ];
  for (const m of msgs) {
    const ta = page.locator("textarea").first();
    await ta.waitFor({ state: "visible", timeout: 10000 });
    await ta.fill(m);
    await ta.press("Enter");
    log(`Sent: ${m.slice(0, 35)}...`);
    await page.waitForTimeout(15000);
  }
  await shot(page, "11-brainstorm-conversation.png", { fullPage: true });

  // Trigger outline
  await page.evaluate(async (sid) => {
    await fetch(`/api/v1/brainstorm/sessions/${sid}/generate-outline`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
  }, sessionId);
  log("Outline generation triggered");

  // Poll for outline
  const olDeadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < olDeadline) {
    const sd = await page.evaluate(async (sid) => {
      const r = await fetch(`/api/v1/brainstorm/sessions/${sid}`);
      return (await r.json()).data;
    }, sessionId);
    if (sd.outline) { log("Outline ready!"); break; }
    await page.waitForTimeout(10000);
  }
  await shot(page, "12-outline-generated.png", { fullPage: true });

  // Create draft
  const draftResult = await page.evaluate(async (sid) => {
    const r = await fetch("/api/v1/drafts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid }),
    });
    return await r.json();
  }, sessionId);
  const draftId = draftResult.data?.id;
  log(`Draft: ${draftId}`);

  // Navigate to writing page
  await page.goto(`/writing/${draftId}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  await shot(page, "13-writing-page.png", { fullPage: true });

  // Generate 2 sections
  const sections = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/drafts/${id}`);
    return (await r.json()).data.sections.filter((s) => s.parentId === null).slice(0, 2);
  }, draftId);
  log(`Sections: ${sections.map((s) => (s.title || "").slice(0, 25)).join(" | ")}`);

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const t = Date.now();
    log(`Generating section ${i + 1}: ${(sec.title || "").slice(0, 40)}`);
    const result = await page.evaluate(async ({ id, secId }) => {
      const resp = await fetch(`/api/v1/drafts/${id}/sections/${secId}/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ constraints: { wordLimit: 800 } }),
      });
      const text = await resp.text();
      let refCount = 0, refTypes = [];
      try {
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ") && line.includes("references")) {
            const data = JSON.parse(line.slice(6));
            if (data.references) { refCount = data.references.length; refTypes = [...new Set(data.references.map((r) => r.sourceType || "rag"))]; }
          }
        }
      } catch {}
      return { status: resp.status, len: text.length, refCount, refTypes };
    }, { id: draftId, secId: sec.id });
    log(`  status=${result.status} refs=${result.refCount} types=[${result.refTypes.join(",")}] time=${((Date.now() - t) / 1000).toFixed(1)}s`);
    await page.evaluate(async ({ id, secId }) => {
      await fetch(`/api/v1/drafts/${id}/sections/${secId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    }, { id: draftId, secId: sec.id });
    log("  confirmed");
  }

  // Screenshot writing page with generated sections
  await page.goto(`/writing/${draftId}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  await shot(page, "14-writing-sections-generated.png", { fullPage: true });

  // Regenerate section 1
  log("Regenerating section 1...");
  await page.evaluate(async ({ id, secId }) => {
    await fetch(`/api/v1/drafts/${id}/sections/${secId}/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetStatus: "pending" }) });
  }, { id: draftId, secId: sections[0].id });
  const regen = await page.evaluate(async ({ id, secId }) => {
    const t = Date.now();
    const resp = await fetch(`/api/v1/drafts/${id}/sections/${secId}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ constraints: { wordLimit: 600 } }) });
    const text = await resp.text();
    return { status: resp.status, len: text.length, time: ((Date.now() - t) / 1000).toFixed(1) };
  }, { id: draftId, secId: sections[0].id });
  log(`Regen: status=${regen.status} len=${regen.len} time=${regen.time}s`);
  await page.evaluate(async ({ id, secId }) => {
    await fetch(`/api/v1/drafts/${id}/sections/${secId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  }, { id: draftId, secId: sections[0].id });

  // Verify references
  log("=== Reference verification ===");
  const final = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/drafts/${id}`);
    return (await r.json()).data;
  }, draftId);
  for (const sec of (final.sections || []).filter((s) => s.parentId === null).slice(0, 2)) {
    const refs = sec.references || [];
    log(`Section "${(sec.title || "").slice(0, 30)}": ${refs.length} refs, content ${(sec.content || "").length} chars`);
    for (const r of refs.slice(0, 2)) {
      log(`  [${r.sourceType || "rag"}] ${(r.documentName || "").slice(0, 25)}: ${(r.content || "").slice(0, 70)}`);
    }
  }

  // Final screenshot
  await page.goto(`/writing/${draftId}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  await shot(page, "15-writing-final.png", { fullPage: true });

  log("=== SCREENSHOT VERIFICATION CYCLE COMPLETE ===");
  log(`Screenshots saved to ${SHOTS}/`);
  await browser.close();
})().catch((e) => { console.error("FAIL:", e.message, e.stack); process.exit(1); });
