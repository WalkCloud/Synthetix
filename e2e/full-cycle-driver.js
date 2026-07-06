/**
 * Synthetix full-cycle browser driver.
 *
 * Drives the REAL Chrome browser (via Playwright standalone, not the test
 * runner) through the complete user journey:
 *   1. Verify library/wiki/graph pages are clean (post-delete state)
 *   2. Upload 3 docs (epub+docx+pdf) in graph mode via the upload UI
 *   3. Monitor pipeline progress until all 3 graphs complete
 *   4. Brainstorm (chat) → outline generation → import to writing
 *   5. Generate 2 sections + test regenerate + verify wiki/rag references
 *
 * Reuses the auth state in e2e/.auth/admin.json (refreshed before each run).
 * Run with: node e2e/full-cycle-driver.js <cycleNum> <topic>
 *
 * Each phase logs progress to stdout AND to e2e/.report/cycle-<N>.json so
 * partial progress survives crashes.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const AUTH_FILE = "e2e/.auth/admin.json";
const REPORT_DIR = "e2e/.report";
const USER_TEST_DIR = "E:/test doc";

const cycleNum = parseInt(process.argv[2] || "1", 10);
const topic = process.argv[3] || "容器云平台架构设计";
const reportFile = path.join(REPORT_DIR, `cycle-${cycleNum}.json`);

// Topics per cycle (user wants different topics each cycle)
const CYCLE_TOPICS = {
  1: "容器云平台架构设计",
  2: "精益创业方法论",
  3: "云原生应用实践",
};

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[cycle ${cycleNum} ${ts}] ${msg}`);
}

function loadReport() {
  try {
    const r = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    // Ensure required fields exist (file may be from a partial/crashed run)
    if (!Array.isArray(r.events)) r.events = [];
    if (!r.phases || typeof r.phases !== "object") r.phases = {};
    r.cycle = cycleNum;
    r.topic = topic;
    return r;
  } catch {
    return { cycle: cycleNum, topic, phases: {}, events: [] };
  }
}

function saveReport(report) {
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    report.updatedAt = new Date().toISOString();
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  } catch (e) {
    log(`WARN: failed to save report: ${e.message}`);
  }
}

function recordEvent(report, phase, event, data) {
  report.events.push({ ts: new Date().toISOString(), phase, event, ...(data || {}) });
  report.phases[phase] = report.phases[phase] || {};
  report.phases[phase].lastEvent = event;
  report.phases[phase].lastData = data;
  saveReport(report);
}

async function apiGet(page, urlPath) {
  const resp = await page.request.get(`${BASE}${urlPath}`);
  const body = await resp.json();
  if (!body.success) throw new Error(`GET ${urlPath} failed: ${body.error || resp.status()}`);
  return body.data;
}

async function apiPost(page, urlPath, data) {
  const resp = await page.request.post(`${BASE}${urlPath}`, {
    data,
    headers: { "Content-Type": "application/json" },
  });
  const body = await resp.json();
  return body;
}

async function apiDelete(page, urlPath) {
  const resp = await page.request.delete(`${BASE}${urlPath}`);
  const body = await resp.json();
  return body;
}

// Resolve test doc files dynamically (some have NBSP in names)
function resolveTestDocs() {
  const files = fs.readdirSync(USER_TEST_DIR);
  const wanted = [
    { ext: ".epub", format: "epub" },
    { ext: ".docx", format: "docx" },
    { ext: ".pdf", format: "pdf" },
  ];
  return wanted.map(({ ext, format }) => {
    const match = files.find((f) => f.toLowerCase().endsWith(ext));
    return match ? { path: path.join(USER_TEST_DIR, match), format, name: match } : null;
  }).filter(Boolean);
}

async function main() {
  const report = loadReport();
  log(`=== CYCLE ${cycleNum} START — topic: "${topic}" ===`);
  recordEvent(report, "start", "cycle_started", { cycle: cycleNum, topic });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE, locale: "zh-CN" });

  // Load saved auth (cookies)
  if (fs.existsSync(AUTH_FILE)) {
    const authState = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (authState.cookies) await context.addCookies(authState.cookies);
  } else {
    log("ERROR: no auth file — run login first");
    process.exit(1);
  }

  const page = await context.newPage();

  try {
    // ════════════════════════════════════════════════════════════════════
    // PHASE 1: Verify clean state (library/wiki/graph should be empty)
    // ════════════════════════════════════════════════════════════════════
    log("--- PHASE 1: Verify clean state ---");
    await page.goto("/library");
    await page.waitForLoadState("networkidle");
    const libDocs = await apiGet(page, "/api/v1/library/documents").catch(() => []);
    log(`Library docs: ${libDocs.length}`);

    const wikiEntries = await apiGet(page, "/api/v1/wiki/entries?page=1&limit=1").catch(() => ({ items: [] }));
    const wikiCount = wikiEntries.total || (wikiEntries.items || []).length;
    log(`Wiki entries: ${wikiCount}`);

    const graph = await apiGet(page, "/api/v1/knowledge/graph?mode=core&max_nodes=10&min_degree=1").catch(() => ({ graph: { nodes: [], edges: [] } }));
    const graphNodes = (graph.graph?.nodes || []).length;
    log(`Graph nodes: ${graphNodes}`);

    recordEvent(report, "clean_check", "verified", { libDocs: libDocs.length, wikiEntries: wikiCount, graphNodes });

    // If there are leftover docs, delete them via the UI/API
    if (libDocs.length > 0) {
      log(`Deleting ${libDocs.length} leftover docs...`);
      for (const doc of libDocs) {
        await apiDelete(page, `/api/v1/documents/${doc.id}?deleteWiki=true`);
        log(`  deleted ${doc.id.slice(0, 8)} (${doc.originalName?.slice(0, 30)})`);
      }
      // Wait for cleanups to finish
      await page.waitForTimeout(30000);
      const remaining = await apiGet(page, "/api/v1/library/documents").catch(() => []);
      log(`After delete: ${remaining.length} docs remaining`);
      recordEvent(report, "clean_check", "deleted_leftovers", { count: libDocs.length, remaining: remaining.length });
    }

    // ════════════════════════════════════════════════════════════════════
    // PHASE 2: Upload 3 docs via browser UI
    // ════════════════════════════════════════════════════════════════════
    log("--- PHASE 2: Upload 3 docs via browser UI ---");
    const testDocs = resolveTestDocs();
    log(`Test docs found: ${testDocs.map((d) => d.format).join(", ")}`);
    if (testDocs.length < 3) {
      throw new Error(`Expected 3 test docs, found ${testDocs.length}`);
    }

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: "attached", timeout: 15000 });

    // Try to select graph mode via UI
    const graphModeBtn = page.locator("button, [role='radio'], label").filter({ hasText: /graph|图谱|知识图谱/i }).first();
    if (await graphModeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await graphModeBtn.click();
      log("Selected graph Knowledge Mode via UI");
    }

    // Upload all 3 at once
    const uploadStart = Date.now();
    const uploadResponses = testDocs.map((doc) =>
      page.waitForResponse(
        (r) => r.url().includes("/api/v1/documents/upload") && r.request().method() === "POST",
        { timeout: 180000 }
      ).then(async (r) => ({ doc: doc.format, body: await r.json() }))
    );
    await fileInput.setInputFiles(testDocs.map((d) => d.path));
    const responses = await Promise.all(uploadResponses);
    const uploadMs = Date.now() - uploadStart;
    log(`Upload responses received in ${uploadMs}ms`);

    // Get docIds — uploads land in 'pending' status, which is excluded from the
    // default list. Query pending explicitly, then fall back to all-status.
    await page.waitForTimeout(5000);
    let uploadedDocs = await apiGet(page, "/api/v1/library/documents?status=pending").catch(() => []);
    if (uploadedDocs.length < 3) {
      // Fall back: try the documents endpoint (broader)
      uploadedDocs = await apiGet(page, "/api/v1/library/documents?status=queued").catch(() => []);
      const pending = await apiGet(page, "/api/v1/library/documents?status=pending").catch(() => []);
      uploadedDocs = [...uploadedDocs, ...pending];
    }
    // Dedupe by id
    const seen = new Set();
    uploadedDocs = uploadedDocs.filter((d) => seen.has(d.id) ? false : (seen.add(d.id), true));
    log(`After upload: ${uploadedDocs.length} docs`);
    const docIds = testDocs.map((doc) => {
      const match = uploadedDocs.find((d) => d.originalName === doc.name);
      return match ? { docId: match.id, format: doc.format, name: doc.name } : null;
    }).filter(Boolean);

    if (docIds.length !== 3) {
      throw new Error(`Expected 3 docIds after upload, got ${docIds.length}`);
    }
    log(`Uploaded: ${docIds.map((d) => `${d.format}=${d.docId.slice(0, 8)}`).join(", ")}`);
    recordEvent(report, "upload", "complete", { docIds, uploadMs });

    // Click "Start Processing" via UI
    const startBtn = page.locator("button").filter({ hasText: /start processing|开始处理|处理|开始/i }).first();
    if (await startBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await startBtn.click();
      log("Clicked Start Processing via UI");
      await page.waitForURL(/\/library/, { timeout: 30000 }).catch(() => {});
    } else {
      log("Start button not found, triggering via API");
      for (const d of docIds) {
        await apiPost(page, `/api/v1/documents/${d.docId}/reprocess`, {
          options: { splitStrategy: "structure-llm", indexTarget: "full", indexMode: "graph", wikiEnabled: false, autoSplit: true },
        });
      }
    }
    recordEvent(report, "upload", "processing_started");

    // ════════════════════════════════════════════════════════════════════
    // PHASE 3: Monitor pipeline until all graphs complete
    // ════════════════════════════════════════════════════════════════════
    log("--- PHASE 3: Monitor pipeline until all graphs complete ---");
    const graphStart = Date.now();
    const pipelineDeadline = Date.now() + 5 * 60 * 60 * 1000; // 5h cap
    let lastStatus = {};

    while (Date.now() < pipelineDeadline) {
      let allReady = true;
      const states = {};
      for (const d of docIds) {
        const detail = await apiGet(page, `/api/v1/library/documents/${d.docId}`).catch(() => null);
        if (!detail) continue;
        const ds = detail.displayStatus;
        const graphBranch = (detail.pipeline?.branches || []).find((b) => b.key === "stageGraph");
        const graphStatus = graphBranch?.status || "?";
        const graphProgress = graphBranch?.progress || 0;
        states[d.format] = { displayStatus: ds, graphStatus, graphProgress };

        // Frontend-backend consistency: list vs detail displayStatus
        // (only check periodically to avoid spam)
        const listDocs = await apiGet(page, "/api/v1/library/documents").catch(() => []);
        const listEntry = listDocs.find((x) => x.id === d.docId);
        if (listEntry && listEntry.displayStatus !== ds) {
          log(`WARN: list/detail drift for ${d.format}: list=${listEntry.displayStatus} detail=${ds}`);
          recordEvent(report, "pipeline", "status_drift", { doc: d.format, list: listEntry.displayStatus, detail: ds });
        }

        if (ds !== "ready" || graphStatus !== "done") allReady = false;
        if (graphStatus === "failed") {
          log(`ERROR: ${d.format} graph FAILED`);
          recordEvent(report, "pipeline", "graph_failed", { doc: d.format });
        }
      }

      const elapsed = Math.floor((Date.now() - graphStart) / 60000);
      // Log on state change
      const stateKey = JSON.stringify(states);
      if (stateKey !== JSON.stringify(lastStatus)) {
        const summary = Object.entries(states).map(([f, s]) => `${f}=${s.displayStatus}/g:${s.graphStatus}(${s.graphProgress}%)`).join(" ");
        log(`[${elapsed}m] ${summary}`);
        lastStatus = Object.assign({}, states);
      }

      if (allReady) {
        log(`All 3 graphs DONE at ${elapsed}m`);
        recordEvent(report, "pipeline", "all_graphs_done", { elapsedMin: elapsed });
        break;
      }
      await page.waitForTimeout(60000); // poll every 60s
    }

    // Capture final graph stats
    const finalGraph = await apiGet(page, "/api/v1/knowledge/graph?mode=core&max_nodes=500&min_degree=1").catch(() => ({ graph: { nodes: [], edges: [] } }));
    const totalNodes = (finalGraph.graph?.nodes || []).length;
    const totalEdges = (finalGraph.graph?.edges || []).length;
    log(`Final combined graph: ${totalNodes} nodes / ${totalEdges} edges`);

    // Entity-evidence latency check (A2 fix verification)
    const eeStart = Date.now();
    const eeEntity = "platform";
    await page.request.get(`${BASE}/api/v1/knowledge/entity-evidence?entity=${encodeURIComponent(eeEntity)}`).catch(() => {});
    const eeMs = Date.now() - eeStart;
    log(`Entity-evidence (${eeEntity}): ${eeMs}ms`);

    recordEvent(report, "pipeline", "complete", { totalNodes, totalEdges, entityEvidenceMs: eeMs });

    // ════════════════════════════════════════════════════════════════════
    // PHASE 4: Brainstorm → Outline → Import to Writing
    // ════════════════════════════════════════════════════════════════════
    log(`--- PHASE 4: Brainstorm (topic: "${topic}") → Outline → Writing ---`);
    await page.goto("/brainstorm");
    await page.waitForLoadState("networkidle");

    // Click "Start Conversation"
    const startConvBtn = page.locator("button").filter({ hasText: /start conversation|开始对话|开始/i }).first();
    await startConvBtn.waitFor({ state: "visible", timeout: 15000 });
    await startConvBtn.click();
    await page.waitForTimeout(2000);
    log("Started brainstorm session");

    // Send messages to drive the brainstorm forward. The facilitator will ask
    // questions; we answer concisely to move through phases (gathering →
    // direction → mode_select → generate).
    const textarea = page.getByPlaceholder(/message|输入|消息|问/i).first();
    if (!await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Fallback: any textarea
      const fallback = page.locator("textarea").first();
      await fallback.waitFor({ state: "visible", timeout: 10000 });
    }

    // Phase 1: describe what we want to write about
    const messages = [
      `我想写一份关于${topic}的深度报告，目标读者是技术决策者。`,
      `篇幅约 8000 字，需要包含架构设计、技术选型、实施路径三个核心部分。`,
      `方向确认：聚焦企业级容器云平台的落地实践，面向中型团队。`,
    ];

    let phase = "gathering";
    let modeSelectSeen = false;
    let outlineStarted = false;

    for (let i = 0; i < messages.length && !outlineStarted; i++) {
      const ta = page.locator("textarea").first();
      await ta.fill(messages[i]);
      await ta.press("Enter");
      log(`Sent message ${i + 1}: "${messages[i].slice(0, 40)}..."`);
      await page.waitForTimeout(8000); // wait for LLM response

      // Check current phase via the session
      const sessResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions`).catch(() => null);
      if (sessResp) {
        const sessBody = await sessResp.json();
        const sessions = sessBody.data || [];
        if (sessions.length > 0) {
          const sessDetail = await page.request.get(`${BASE}/api/v1/brainstorm/sessions/${sessions[0].id}`).catch(() => null);
          if (sessDetail) {
            const sessBody2 = await sessDetail.json();
            const sessData = sessBody2.data;
            log(`  Session status: ${sessData.status}, messages: ${(sessData.messages || []).length}`);
            recordEvent(report, "brainstorm", `message_${i + 1}_sent`, { phase, msgCount: (sessData.messages || []).length });
          }
        }
      }
    }

    // Check if we're in mode_select and need to choose "generate direct"
    // The quick-action button or typing "A" / "生成"
    const generateDirectBtn = page.locator("button").filter({ hasText: /generate direct|直接生成|直接/i }).first();
    if (await generateDirectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await generateDirectBtn.click();
      log("Clicked 'Generate Direct'");
      outlineStarted = true;
    } else {
      // Try typing the generate marker
      const ta = page.locator("textarea").first();
      await ta.fill("A");
      await ta.press("Enter");
      log("Typed 'A' to trigger direct generation");
      await page.waitForTimeout(5000);
      outlineStarted = true;
    }

    // Poll for outline task completion
    log("Waiting for outline generation...");
    const outlineDeadline = Date.now() + 30 * 60 * 1000; // 30min cap
    let outlineReady = false;
    while (Date.now() < outlineDeadline) {
      const sessResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions`).catch(() => null);
      if (sessResp) {
        const sessBody = await sessResp.json();
        const sessions = sessBody.data || [];
        if (sessions.length > 0) {
          const sessDetail = await page.request.get(`${BASE}/api/v1/brainstorm/sessions/${sessions[0].id}`).catch(() => null);
          if (sessDetail) {
            const sessBody2 = await sessDetail.json();
            const sessData = sessBody2.data;
            if (sessData.outline) {
              log(`Outline generated! Title: ${sessData.outlineTitle || "(untitled)"}`);
              recordEvent(report, "brainstorm", "outline_ready", { sessionId: sessData.id });
              outlineReady = true;
              break;
            }
            // Check for running outline task
            const tasks = await page.request.get(`${BASE}/api/v1/tasks?type=outline_generate&limit=1`).catch(() => null);
            if (tasks) {
              const tasksBody = await tasks.json();
              const task = (tasksBody.data || [])[0];
              if (task) {
                log(`  Outline task: ${task.status} ${task.progress}%`);
              }
            }
          }
        }
      }
      await page.waitForTimeout(10000);
    }

    if (!outlineReady) {
      throw new Error("Outline generation did not complete within 30 min");
    }

    // Click "Import to Writing" via UI
    const importBtn = page.locator("button").filter({ hasText: /import to writing|导入写作|开始写作|导入/i }).first();
    if (await importBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await importBtn.click();
      log("Clicked 'Import to Writing'");
      await page.waitForURL(/\/writing\//, { timeout: 30000 }).catch(() => {});
    } else {
      log("Import button not found — checking if we're already on writing page");
    }

    const writingUrl = page.url();
    const draftId = writingUrl.match(/\/writing\/(.+)/)?.[1];
    log(`Writing page URL: ${writingUrl}, draftId: ${draftId}`);
    recordEvent(report, "brainstorm", "writing_started", { draftId });

    if (!draftId) {
      throw new Error("Failed to get draftId from writing page URL");
    }

    // ════════════════════════════════════════════════════════════════════
    // PHASE 5: Generate 2 sections + test regenerate + verify references
    // ════════════════════════════════════════════════════════════════════
    log("--- PHASE 5: Generate 2 sections + regenerate + verify references ---");
    await page.waitForLoadState("networkidle");

    const draft = await apiGet(page, `/api/v1/drafts/${draftId}`);
    const sections = draft.sections || [];
    log(`Draft has ${sections.length} sections`);
    recordEvent(report, "writing", "draft_loaded", { sectionCount: sections.length });

    // Generate the first 2 sections via API (more reliable than UI clicks for SSE)
    for (let i = 0; i < Math.min(2, sections.length); i++) {
      const sec = sections[i];
      log(`Generating section ${i + 1}: "${sec.title?.slice(0, 40)}..." (id: ${sec.id.slice(0, 8)})`);

      const genStart = Date.now();
      // Use the SSE endpoint via fetch — read the stream
      const genResp = await page.request.post(`${BASE}/api/v1/drafts/${draftId}/sections/${sec.id}/generate`, {
        data: { constraints: { wordLimit: sec.estimatedWords || 800 } },
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        timeout: 600000, // 10 min per section
      });

      // The SSE response — read it
      const genText = await genResp.text().catch(() => "");
      const genMs = Date.now() - genStart;
      log(`  Section ${i + 1} generation: ${genMs}ms, response length: ${genText.length}`);

      // Check for references event in the SSE stream
      const hasRefs = genText.includes('"type":"references"') || genText.includes('"references"');
      const refMatch = genText.match(/"references":\s*(\[.*?\])/s);
      let refCount = 0;
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
        sectionId: sec.id,
        title: sec.title,
        genMs,
        refCount,
        refSources,
        contentLen: genText.length,
      });

      // Confirm the section (lock it)
      await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec.id}/confirm`, {});
      log(`  Section ${i + 1} confirmed`);
      recordEvent(report, "writing", `section_${i + 1}_confirmed`);
    }

    // Test REGENERATE on section 1
    log("--- Testing regenerate on section 1 ---");
    const sec1 = sections[0];
    // Unlock section 1 back to pending
    const unlockResp = await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec1.id}/unlock`, { targetStatus: "pending" });
    log(`Unlocked section 1: ${unlockResp.success ? "OK" : "FAILED"}`);

    // Regenerate
    const regenStart = Date.now();
    const regenResp = await page.request.post(`${BASE}/api/v1/drafts/${draftId}/sections/${sec1.id}/generate`, {
      data: { constraints: { wordLimit: 600 } },
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      timeout: 600000,
    });
    const regenText = await regenResp.text().catch(() => "");
    const regenMs = Date.now() - regenStart;
    log(`Regeneration: ${regenMs}ms, length: ${regenText.length}`);
    recordEvent(report, "writing", "section_1_regenerated", { regenMs, contentLen: regenText.length });

    // Re-confirm
    await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec1.id}/confirm`, {});
    log("Section 1 re-confirmed after regenerate");

    // ════════════════════════════════════════════════════════════════════
    // PHASE 6: Verify wiki/RAG references match section content
    // ════════════════════════════════════════════════════════════════════
    log("--- PHASE 6: Verify wiki/RAG references ---");
    const refreshedDraft = await apiGet(page, `/api/v1/drafts/${draftId}`);
    const refSections = (refreshedDraft.sections || []).slice(0, 2);
    for (const sec of refSections) {
      const refs = sec.references || [];
      log(`Section "${sec.title?.slice(0, 30)}": ${refs.length} references`);
      for (const r of refs.slice(0, 3)) {
        log(`  - [${r.sourceType || "rag"}] ${r.documentName?.slice(0, 25)}: ${(r.content || "").slice(0, 80)}...`);
      }
      // Verify reference relevance: does the section content mention key terms from refs?
      const content = sec.content || "";
      const refKeywords = refs.slice(0, 3).flatMap((r) => (r.content || "").split(/\s+/).filter((w) => w.length > 3)).slice(0, 10);
      const matchedKeywords = refKeywords.filter((k) => content.includes(k));
      const relevanceRatio = refKeywords.length > 0 ? matchedKeywords.length / refKeywords.length : 0;
      log(`  Reference relevance: ${matchedKeywords.length}/${refKeywords.length} keywords matched (${(relevanceRatio * 100).toFixed(0)}%)`);
      recordEvent(report, "writing", "references_verified", {
        sectionId: sec.id,
        refCount: refs.length,
        relevanceRatio,
      });
    }

    log(`=== CYCLE ${cycleNum} COMPLETE ===`);
    recordEvent(report, "complete", "cycle_complete", { cycle: cycleNum });

  } catch (err) {
    log(`ERROR: ${err.message}`);
    log(err.stack?.split("\n").slice(0, 3).join("\n"));
    recordEvent(report, "error", "cycle_failed", { error: err.message, stack: err.stack?.slice(0, 500) });

    // Try to take a screenshot for debugging
    try {
      await page.screenshot({ path: path.join(REPORT_DIR, `cycle-${cycleNum}-error.png`) });
      log("Saved error screenshot");
    } catch {}

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
