/**
 * Cycle 1 continuation — picks up after upload+processing-started.
 *
 * The 3 docs are already uploaded (06b03853=epub, a261b1f6=docx, 8cc823a6=pdf)
 * and processing in graph mode. This script:
 *   - Monitors until all 3 graphs complete
 *   - Runs the brainstorm → outline → writing flow
 *
 * Reuses the same auth + helper functions as full-cycle-driver.js.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const AUTH_FILE = "e2e/.auth/admin.json";
const REPORT_DIR = "e2e/.report";
const reportFile = path.join(REPORT_DIR, "cycle-1.json");

const DOC_IDS = {
  epub: "06b03853-64e3-4e63-9813-7e1c502e4d81",
  docx: "a261b1f6-a104-40be-aeb4-ca12e5241827",
  pdf: "8cc823a6-6a91-419a-9a07-30498925017c",
};

const topic = "容器云平台架构设计";

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[cycle 1 ${ts}] ${msg}`);
}

async function loadReport() {
  try {
    const r = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    if (!Array.isArray(r.events)) r.events = [];
    if (!r.phases) r.phases = {};
    return r;
  } catch {
    return { cycle: 1, topic, phases: {}, events: [] };
  }
}

function saveReport(r) {
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    r.updatedAt = new Date().toISOString();
    fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
  } catch {}
}

function recordEvent(r, phase, event, data) {
  r.events.push({ ts: new Date().toISOString(), phase, event, ...(data || {}) });
  saveReport(r);
}

async function apiGet(page, urlPath) {
  const resp = await page.request.get(`${BASE}${urlPath}`);
  const body = await resp.json();
  return body.success ? body.data : null;
}

async function apiPost(page, urlPath, data) {
  const resp = await page.request.post(`${BASE}${urlPath}`, {
    data, headers: { "Content-Type": "application/json" },
  });
  return await resp.json();
}

async function main() {
  const report = loadReport();
  log(`=== CYCLE 1 CONTINUE — monitoring graphs (topic: ${topic}) ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE, locale: "zh-CN" });
  if (fs.existsSync(AUTH_FILE)) {
    const authState = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (authState.cookies) await context.addCookies(authState.cookies);
  }
  const page = await context.newPage();

  try {
    // ═══ PHASE 3: Monitor pipeline until all graphs complete ═════════════
    log("--- PHASE 3: Monitor pipeline until all graphs complete ---");
    const graphStart = Date.now();
    const deadline = Date.now() + 5 * 60 * 60 * 1000;
    let lastStateKey = "";

    while (Date.now() < deadline) {
      const states = {};
      let allReady = true;

      for (const [format, docId] of Object.entries(DOC_IDS)) {
        const detail = await apiGet(page, `/api/v1/library/documents/${docId}`).catch(() => null);
        if (!detail) { allReady = false; continue; }
        const ds = detail.displayStatus;
        const gb = (detail.pipeline?.branches || []).find((b) => b.key === "stageGraph");
        const gs = gb?.status || "?";
        const gp = gb?.progress || 0;
        states[format] = { displayStatus: ds, graphStatus: gs, graphProgress: gp };
        if (ds !== "ready" || gs !== "done") allReady = false;

        // Consistency check: list vs detail
        const listDocs = await apiGet(page, "/api/v1/library/documents").catch(() => []);
        const listEntry = listDocs?.find?.((x) => x.id === docId);
        if (listEntry && listEntry.displayStatus !== ds) {
          log(`WARN: ${format} list/detail drift: list=${listEntry.displayStatus} detail=${ds}`);
          recordEvent(report, "pipeline", "status_drift", { doc: format, list: listEntry.displayStatus, detail: ds });
        }
      }

      const elapsed = Math.floor((Date.now() - graphStart) / 60000);
      const stateKey = JSON.stringify(states);
      if (stateKey !== lastStateKey) {
        const summary = Object.entries(states).map(([f, s]) => `${f}=${s.displayStatus}/g:${s.graphStatus}(${s.graphProgress}%)`).join(" ");
        log(`[${elapsed}m] ${summary}`);
        lastStateKey = stateKey;
      }

      if (allReady) {
        log(`All 3 graphs DONE at ${elapsed}m`);
        recordEvent(report, "pipeline", "all_graphs_done", { elapsedMin: elapsed });
        break;
      }
      await page.waitForTimeout(60000);
    }

    // Final graph stats + entity-evidence
    const finalGraph = await apiGet(page, "/api/v1/knowledge/graph?mode=core&max_nodes=500&min_degree=1").catch(() => ({ graph: { nodes: [], edges: [] } }));
    const totalNodes = finalGraph?.graph?.nodes?.length || 0;
    const totalEdges = finalGraph?.graph?.edges?.length || 0;
    log(`Final combined graph: ${totalNodes} nodes / ${totalEdges} edges`);

    const eeStart = Date.now();
    await page.request.get(`${BASE}/api/v1/knowledge/entity-evidence?entity=platform`).catch(() => {});
    const eeMs = Date.now() - eeStart;
    log(`Entity-evidence (platform): ${eeMs}ms`);
    recordEvent(report, "pipeline", "complete", { totalNodes, totalEdges, entityEvidenceMs: eeMs });

    // ═══ PHASE 4: Brainstorm → Outline → Writing ═══════════════════════
    log(`--- PHASE 4: Brainstorm (topic: "${topic}") ---`);
    await page.goto("/brainstorm");
    await page.waitForLoadState("networkidle");

    // Click "Start Conversation"
    const startConvBtn = page.locator("button").filter({ hasText: /start conversation|开始对话|开始/i }).first();
    await startConvBtn.waitFor({ state: "visible", timeout: 15000 });
    await startConvBtn.click();
    await page.waitForTimeout(2000);
    log("Started brainstorm session");

    // Get the session ID
    const sessListResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions`);
    const sessListBody = await sessListResp.json();
    const sessions = sessListBody.data || [];
    const sessionId = sessions[0]?.id;
    log(`Session ID: ${sessionId}`);
    recordEvent(report, "brainstorm", "session_started", { sessionId });

    // Send brainstorm messages to drive the conversation forward
    const messages = [
      `我想写一份关于${topic}的深度报告，目标读者是企业技术决策者。`,
      `篇幅约 8000 字，需要包含架构设计、技术选型、实施路径三个核心部分。`,
      `方向确认：聚焦企业级容器云平台的落地实践，面向中型技术团队。`,
    ];

    for (let i = 0; i < messages.length; i++) {
      const ta = page.locator("textarea").first();
      await ta.waitFor({ state: "visible", timeout: 10000 });
      await ta.fill(messages[i]);
      await ta.press("Enter");
      log(`Sent message ${i + 1}: "${messages[i].slice(0, 40)}..."`);
      await page.waitForTimeout(10000);

      // Check phase via the session
      const sdResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions/${sessionId}`);
      const sdBody = await sdResp.json();
      const sd = sdBody.data;
      log(`  Session: status=${sd.status}, messages=${(sd.messages || []).length}`);
      recordEvent(report, "brainstorm", `message_${i + 1}`, { msgCount: (sd.messages || []).length });
    }

    // Try to trigger direct outline generation
    // Option 1: click "Generate Direct" quick-action button if visible
    const genDirectBtn = page.locator("button").filter({ hasText: /generate direct|直接生成完整大纲|直接生成|立即生成/i }).first();
    let outlineTriggered = false;
    if (await genDirectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genDirectBtn.click();
      log("Clicked 'Generate Direct' button");
      outlineTriggered = true;
    } else {
      // Option 2: type "生成" / "A" to trigger generation marker
      const ta = page.locator("textarea").first();
      await ta.fill("生成大纲");
      await ta.press("Enter");
      log("Typed '生成大纲' to trigger generation");
      outlineTriggered = true;
      await page.waitForTimeout(5000);
    }

    // Option 3: if there's a standalone "Generate Outline" button in the right panel
    if (!outlineTriggered) {
      const genOutlineBtn = page.locator("button").filter({ hasText: /generate outline|生成大纲|生成/i }).first();
      if (await genOutlineBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await genOutlineBtn.click();
        log("Clicked 'Generate Outline' button");
      }
    }

    // Poll for outline completion (background task)
    log("Waiting for outline generation...");
    const outlineDeadline = Date.now() + 30 * 60 * 1000;
    let outlineReady = false;
    while (Date.now() < outlineDeadline) {
      const sdResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions/${sessionId}`);
      const sdBody = await sdResp.json();
      const sd = sdBody.data;
      if (sd.outline) {
        const outlineTitle = sd.outlineTitle || "(untitled)";
        const sectionCount = Array.isArray(sd.outline) ? sd.outline.length : (sd.outline.sections?.length || 0);
        log(`Outline READY! Title: ${outlineTitle}, sections: ${sectionCount}`);
        recordEvent(report, "brainstorm", "outline_ready", { outlineTitle, sectionCount });
        outlineReady = true;
        break;
      }
      // Check task progress
      const tasksResp = await page.request.get(`${BASE}/api/v1/tasks?type=outline_generate&limit=1`);
      const tasksBody = await tasksResp.json();
      const task = (tasksBody.data || [])[0];
      if (task) {
        const elapsed = Math.floor((Date.now() - graphStart) / 60000);
        log(`  Outline task: ${task.status} ${task.progress}% (at ${elapsed}m)`);
      }
      await page.waitForTimeout(10000);
    }

    if (!outlineReady) {
      throw new Error("Outline did not complete in 30 min");
    }

    // Click "Import to Writing"
    const importBtn = page.locator("button").filter({ hasText: /import to writing|导入写作|开始写作|确认.*写作|导入.*草稿/i }).first();
    if (await importBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await importBtn.click();
      log("Clicked 'Import to Writing'");
      await page.waitForURL(/\/writing\//, { timeout: 30000 }).catch(() => {});
    }
    const writingUrl = page.url();
    const draftId = writingUrl.match(/\/writing\/(.+)/)?.[1];
    log(`Writing page: ${writingUrl}, draftId: ${draftId}`);
    recordEvent(report, "brainstorm", "writing_started", { draftId });

    if (!draftId) throw new Error("No draftId in writing URL");

    // ═══ PHASE 5: Generate 2 sections + regenerate + verify refs ════════
    log("--- PHASE 5: Generate 2 sections ---");
    await page.waitForLoadState("networkidle");
    const draft = await apiGet(page, `/api/v1/drafts/${draftId}`);
    const sections = draft.sections || [];
    log(`Draft has ${sections.length} sections`);
    recordEvent(report, "writing", "draft_loaded", { sectionCount: sections.length });

    for (let i = 0; i < Math.min(2, sections.length); i++) {
      const sec = sections[i];
      log(`Generating section ${i + 1}: "${(sec.title || "").slice(0, 40)}" (${sec.id.slice(0, 8)})`);
      const genStart = Date.now();
      const genResp = await page.request.post(`${BASE}/api/v1/drafts/${draftId}/sections/${sec.id}/generate`, {
        data: { constraints: { wordLimit: sec.estimatedWords || 800 } },
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        timeout: 600000,
      });
      const genText = await genResp.text().catch(() => "");
      const genMs = Date.now() - genStart;
      log(`  Section ${i + 1}: ${genMs}ms, ${genText.length} chars`);

      // Parse references from SSE
      let refCount = 0;
      const refMatch = genText.match(/"references":\s*(\[.*?\])/s);
      let refSources = [];
      if (refMatch) {
        try {
          const refs = JSON.parse(refMatch[1]);
          refCount = refs.length;
          refSources = [...new Set(refs.map((r) => r.sourceType || r.documentName || "unknown"))];
        } catch {}
      }
      log(`  References: ${refCount} (sources: ${refSources.join(", ")})`);
      recordEvent(report, "writing", `section_${i + 1}_generated`, {
        sectionId: sec.id, title: sec.title, genMs, refCount, refSources,
      });

      // Confirm the section
      await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec.id}/confirm`, {});
      log(`  Section ${i + 1} confirmed`);
      recordEvent(report, "writing", `section_${i + 1}_confirmed`);
    }

    // Test REGENERATE on section 1
    log("--- Testing regenerate on section 1 ---");
    const sec1 = sections[0];
    await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec1.id}/unlock`, { targetStatus: "pending" });
    log("Unlocked section 1 → pending");
    const regenStart = Date.now();
    const regenResp = await page.request.post(`${BASE}/api/v1/drafts/${draftId}/sections/${sec1.id}/generate`, {
      data: { constraints: { wordLimit: 600 } },
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      timeout: 600000,
    });
    const regenText = await regenResp.text().catch(() => "");
    const regenMs = Date.now() - regenStart;
    log(`Regeneration: ${regenMs}ms, ${regenText.length} chars`);
    await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec1.id}/confirm`, {});
    log("Section 1 re-confirmed after regenerate");
    recordEvent(report, "writing", "section_1_regenerated", { regenMs, contentLen: regenText.length });

    // ═══ PHASE 6: Verify wiki/RAG references ═══════════════════════════
    log("--- PHASE 6: Verify wiki/RAG references ---");
    const refreshedDraft = await apiGet(page, `/api/v1/drafts/${draftId}`);
    for (const sec of (refreshedDraft.sections || []).slice(0, 2)) {
      const refs = sec.references || [];
      const content = sec.content || "";
      log(`Section "${(sec.title || "").slice(0, 30)}": ${refs.length} refs`);
      for (const r of refs.slice(0, 3)) {
        log(`  [${r.sourceType || "rag"}] ${(r.documentName || "").slice(0, 25)}: ${(r.content || "").slice(0, 80)}...`);
      }
      // Relevance check: keywords from refs that appear in section content
      const refKeywords = refs.slice(0, 3).flatMap((r) => (r.content || "").split(/[\s,，。、]+/).filter((w) => w.length > 3)).slice(0, 15);
      const matched = refKeywords.filter((k) => content.includes(k));
      const ratio = refKeywords.length > 0 ? matched.length / refKeywords.length : 0;
      log(`  Relevance: ${matched.length}/${refKeywords.length} keywords (${(ratio * 100).toFixed(0)}%)`);
      recordEvent(report, "writing", "references_verified", {
        sectionId: sec.id, refCount: refs.length, relevanceRatio: ratio,
      });
    }

    log(`=== CYCLE 1 COMPLETE ===`);
    recordEvent(report, "complete", "cycle_complete");

  } catch (err) {
    log(`ERROR: ${err.message}`);
    recordEvent(report, "error", "failed", { error: err.message, stack: err.stack?.slice(0, 500) });
    try { await page.screenshot({ path: path.join(REPORT_DIR, "cycle-1-error.png") }); } catch {}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
