/**
 * Cycle 1 writing phase — brainstorm → outline → write 2 sections.
 *
 * Prerequisites: 3 docs uploaded, graph complete (all ready/done).
 * Runs the brainstorm conversation, generates outline, imports to writing,
 * generates 2 sections, tests regenerate, verifies wiki/rag references.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const AUTH_FILE = "e2e/.auth/admin.json";
const REPORT_DIR = "e2e/.report";
const reportFile = path.join(REPORT_DIR, "cycle-1.json");
const topic = "容器云平台架构设计";

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[cycle 1 writing ${ts}] ${msg}`);
}

function loadReport() {
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
  log(`=== CYCLE 1 WRITING PHASE — topic: "${topic}" ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE, locale: "zh-CN" });
  if (fs.existsSync(AUTH_FILE)) {
    const authState = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (authState.cookies) await context.addCookies(authState.cookies);
  }
  const page = await context.newPage();

  try {
    // ═══ PHASE 4: Brainstorm → Outline → Writing ═══════════════════════
    log("--- Brainstorm phase ---");
    await page.goto("/brainstorm");
    await page.waitForLoadState("networkidle");

    // Click "Start Conversation"
    const startConvBtn = page.locator("button").filter({ hasText: /start conversation|开始对话|开始/i }).first();
    await startConvBtn.waitFor({ state: "visible", timeout: 15000 });
    await startConvBtn.click();
    await page.waitForTimeout(3000);
    log("Started brainstorm session");

    // Get session ID
    const sessResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions`);
    const sessBody = await sessResp.json();
    const sessions = sessBody.data || [];
    const sessionId = sessions[0]?.id;
    if (!sessionId) throw new Error("No brainstorm session created");
    log(`Session: ${sessionId}`);
    recordEvent(report, "brainstorm", "session_started", { sessionId });

    // Send 3 messages to drive through gathering → direction → mode_select
    const messages = [
      `我想写一份关于${topic}的深度技术报告，目标读者是企业技术决策者和架构师。`,
      `篇幅约 8000 字，需要覆盖架构设计、技术选型、实施路径三大核心模块。`,
      `方向：聚焦企业级容器云平台落地实践，面向 50-200 人的中型技术团队，强调可操作性。`,
    ];

    for (let i = 0; i < messages.length; i++) {
      const ta = page.locator("textarea").first();
      await ta.waitFor({ state: "visible", timeout: 10000 });
      await ta.fill(messages[i]);
      await ta.press("Enter");
      log(`Message ${i + 1} sent: "${messages[i].slice(0, 35)}..."`);
      // Wait for LLM response (streaming, ~10-20s)
      await page.waitForTimeout(15000);

      const sdResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions/${sessionId}`);
      const sdBody = await sdResp.json();
      const sd = sdBody.data;
      const msgCount = (sd.messages || []).length;
      log(`  Session messages: ${msgCount}, status: ${sd.status}`);
      recordEvent(report, "brainstorm", `msg_${i + 1}`, { msgCount });
    }

    // Trigger outline generation — try multiple approaches
    log("Triggering outline generation...");
    let outlineTriggered = false;

    // Approach 1: click "Generate Direct" quick-action button (if in mode_select phase)
    const genDirectBtn = page.locator("button").filter({ hasText: /generate direct|直接生成完整大纲|直接生成|立即生成/i }).first();
    if (await genDirectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await genDirectBtn.click();
      log("Clicked 'Generate Direct'");
      outlineTriggered = true;
    }

    // Approach 2: type "生成大纲" to trigger generation marker
    if (!outlineTriggered) {
      const ta = page.locator("textarea").first();
      await ta.fill("生成大纲");
      await ta.press("Enter");
      log("Typed '生成大纲'");
      outlineTriggered = true;
      await page.waitForTimeout(8000);
    }

    // Approach 3: click standalone "Generate Outline" button in right panel
    if (!outlineTriggered) {
      const genOutlineBtn = page.locator("button").filter({ hasText: /generate outline|生成大纲/i }).first();
      if (await genOutlineBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await genOutlineBtn.click();
        log("Clicked 'Generate Outline' button");
        outlineTriggered = true;
      }
    }

    // Approach 4: call the API directly
    if (!outlineTriggered) {
      log("Falling back to outline API");
      await apiPost(page, `/api/v1/brainstorm/sessions/${sessionId}/generate-outline`, {});
    }

    // Poll for outline completion (background outline_generate task)
    log("Waiting for outline generation (up to 30 min)...");
    const outlineDeadline = Date.now() + 30 * 60 * 1000;
    let outlineReady = false;
    let pollCount = 0;
    while (Date.now() < outlineDeadline) {
      const sdResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions/${sessionId}`);
      const sdBody = await sdResp.json();
      const sd = sdBody.data;
      if (sd.outline) {
        const outlineTitle = sd.outlineTitle || "(untitled)";
        // Count sections in the outline
        let sectionCount = 0;
        if (Array.isArray(sd.outline)) {
          sectionCount = sd.outline.length;
        } else if (sd.outline.sections) {
          sectionCount = sd.outline.sections.length;
        } else if (typeof sd.outline === "string") {
          try {
            const parsed = JSON.parse(sd.outline);
            sectionCount = Array.isArray(parsed) ? parsed.length : (parsed.sections?.length || 0);
          } catch {}
        }
        log(`Outline READY! Title: "${outlineTitle}", sections: ${sectionCount}`);
        recordEvent(report, "brainstorm", "outline_ready", { outlineTitle, sectionCount });
        outlineReady = true;
        break;
      }
      // Log task progress every 5 polls
      if (pollCount % 5 === 0) {
        const tasksResp = await page.request.get(`${BASE}/api/v1/tasks?type=outline_generate&limit=1`);
        const tasksBody = await tasksResp.json();
        const task = (tasksBody.data || [])[0];
        if (task) {
          log(`  Outline task: ${task.status} ${task.progress}%`);
        }
      }
      pollCount++;
      await page.waitForTimeout(10000);
    }

    if (!outlineReady) {
      throw new Error("Outline generation did not complete in 30 min");
    }

    // Click "Import to Writing" / "确认" to create draft and navigate
    log("Importing outline to writing...");
    const importBtn = page.locator("button").filter({ hasText: /import to writing|导入写作|开始写作|确认.*写作|导入.*草稿|确认大纲|使用大纲/i }).first();
    if (await importBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await importBtn.click();
      log("Clicked import button");
      await page.waitForURL(/\/writing\//, { timeout: 30000 }).catch(() => {});
    } else {
      // Fallback: call drafts API directly
      log("Import button not found, calling drafts API");
      const sdResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions/${sessionId}`);
      const sdBody = await sdResp.json();
      const sd = sdBody.data;
      const draftResp = await apiPost(page, `/api/v1/drafts`, {
        sessionId,
        outline: typeof sd.outline === "string" ? JSON.parse(sd.outline) : sd.outline,
      });
      if (draftResp.success && draftResp.data?.id) {
        await page.goto(`/writing/${draftResp.data.id}`);
        await page.waitForLoadState("networkidle");
      }
    }

    const writingUrl = page.url();
    const draftId = writingUrl.match(/\/writing\/(.+)/)?.[1];
    log(`Writing page: ${writingUrl}`);
    log(`Draft ID: ${draftId}`);
    recordEvent(report, "brainstorm", "writing_page_loaded", { draftId });

    if (!draftId) throw new Error("No draftId from writing URL");

    // ═══ PHASE 5: Generate 2 sections + regenerate + verify refs ════════
    log("--- Generating 2 sections ---");
    const draft = await apiGet(page, `/api/v1/drafts/${draftId}`);
    const sections = draft.sections || [];
    log(`Draft has ${sections.length} sections`);
    for (const s of sections.slice(0, 5)) {
      log(`  Section: "${(s.title || "").slice(0, 50)}" (status: ${s.status}, est: ${s.estimatedWords}w)`);
    }
    recordEvent(report, "writing", "draft_loaded", { sectionCount: sections.length });

    // Generate first 2 sections
    for (let i = 0; i < Math.min(2, sections.length); i++) {
      const sec = sections[i];
      log(`--- Generating section ${i + 1}: "${(sec.title || "").slice(0, 40)}..." ---`);
      const genStart = Date.now();
      const genResp = await page.request.post(`${BASE}/api/v1/drafts/${draftId}/sections/${sec.id}/generate`, {
        data: { constraints: { wordLimit: sec.estimatedWords || 800 } },
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        timeout: 600000,
      });
      const genText = await genResp.text().catch(() => "");
      const genMs = Date.now() - genStart;
      log(`  Generated in ${genMs}ms (${genText.length} chars)`);

      // Parse references from SSE
      let refCount = 0;
      let refSources = [];
      const refMatch = genText.match(/"references":\s*(\[[\s\S]*?\])/);
      if (refMatch) {
        try {
          const refs = JSON.parse(refMatch[1]);
          refCount = refs.length;
          refSources = [...new Set(refs.map((r) => r.sourceType || r.documentName || "unknown"))];
          log(`  References: ${refCount} (sources: ${refSources.join(", ")})`);
          for (const r of refs.slice(0, 2)) {
            log(`    [${r.sourceType || "rag"}] ${(r.documentName || "").slice(0, 25)}: ${(r.content || "").slice(0, 70)}...`);
          }
        } catch (e) {
          log(`  Ref parse error: ${e.message}`);
        }
      } else {
        log(`  No references found in SSE stream`);
      }
      recordEvent(report, "writing", `section_${i + 1}_generated`, {
        sectionId: sec.id, title: sec.title, genMs, refCount, refSources,
      });

      // Confirm the section
      const confirmResp = await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec.id}/confirm`, {});
      log(`  Confirmed: ${confirmResp.success ? "OK" : "FAILED"}`);
      recordEvent(report, "writing", `section_${i + 1}_confirmed`);
    }

    // Test REGENERATE on section 1
    log("--- Testing regenerate on section 1 ---");
    const sec1 = sections[0];
    const unlockResp = await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec1.id}/unlock`, { targetStatus: "pending" });
    log(`Unlocked section 1: ${unlockResp.success ? "OK" : "FAILED"}`);

    const regenStart = Date.now();
    const regenResp = await page.request.post(`${BASE}/api/v1/drafts/${draftId}/sections/${sec1.id}/generate`, {
      data: { constraints: { wordLimit: 600 } },
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      timeout: 600000,
    });
    const regenText = await regenResp.text().catch(() => "");
    const regenMs = Date.now() - regenStart;
    log(`Regenerated in ${regenMs}ms (${regenText.length} chars)`);
    await apiPost(page, `/api/v1/drafts/${draftId}/sections/${sec1.id}/confirm`, {});
    log("Section 1 re-confirmed");
    recordEvent(report, "writing", "section_1_regenerated", { regenMs, contentLen: regenText.length });

    // ═══ PHASE 6: Verify wiki/RAG references ═══════════════════════════
    log("--- Verifying wiki/RAG references ---");
    const refreshedDraft = await apiGet(page, `/api/v1/drafts/${draftId}`);
    for (const sec of (refreshedDraft.sections || []).slice(0, 2)) {
      const refs = sec.references || [];
      const content = sec.content || "";
      log(`Section "${(sec.title || "").slice(0, 30)}": ${refs.length} references`);
      for (const r of refs.slice(0, 3)) {
        log(`  [${r.sourceType || "rag"}] ${(r.documentName || "").slice(0, 25)}: ${(r.content || "").slice(0, 80)}...`);
      }
      // Relevance: do keywords from refs appear in section content?
      const refKeywords = refs.slice(0, 3).flatMap((r) =>
        (r.content || "").split(/[\s,，。、；;]+/).filter((w) => w.length > 3)
      ).slice(0, 15);
      const matched = refKeywords.filter((k) => content.includes(k));
      const ratio = refKeywords.length > 0 ? matched.length / refKeywords.length : 0;
      log(`  Relevance: ${matched.length}/${refKeywords.length} keywords (${(ratio * 100).toFixed(0)}%)`);
      recordEvent(report, "writing", "refs_verified", {
        sectionId: sec.id, refCount: refs.length, relevanceRatio: ratio,
      });
    }

    log(`=== CYCLE 1 WRITING PHASE COMPLETE ===`);
    recordEvent(report, "complete", "cycle_complete");

  } catch (err) {
    log(`ERROR: ${err.message}`);
    recordEvent(report, "error", "writing_failed", { error: err.message, stack: err.stack?.slice(0, 500) });
    try { await page.screenshot({ path: path.join(REPORT_DIR, "cycle-1-writing-error.png") }); } catch {}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
