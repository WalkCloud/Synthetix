// Wait for docx graph to complete, then run brainstorm+writing for cycle 3
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost:3000";
const topic = "云原生应用实践";

function log(m) { console.log(`[cycle3 ${new Date().toISOString().slice(11,19)}] ${m}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ baseURL: BASE, locale: "zh-CN" });
  if (fs.existsSync("e2e/.auth/admin.json")) {
    const a = JSON.parse(fs.readFileSync("e2e/.auth/admin.json", "utf8"));
    if (a.cookies) await ctx.addCookies(a.cookies);
  }
  const page = await ctx.newPage();
  await page.goto("/library");
  await page.waitForLoadState("networkidle");

  // ── Wait for docx graph ──
  log("--- Waiting for docx graph ---");
  const start = Date.now();
  while (Date.now() - start < 3 * 60 * 60 * 1000) {
    const docs = await page.evaluate(async () => {
      const r = await fetch("/api/v1/library/documents");
      return (await r.json()).data;
    });
    let docxDone = false;
    let docxProgress = "?";
    for (const d of docs) {
      if (d.originalName && d.originalName.includes("docx")) {
        const detail = await page.evaluate(async (id) => {
          const r = await fetch("/api/v1/library/documents/" + id);
          return (await r.json()).data;
        }, d.id);
        const gb = ((detail.pipeline && detail.pipeline.branches) || []).find((b) => b.key === "stageGraph");
        docxProgress = (gb ? gb.status + " " + gb.progress + "%" : "?");
        if (gb && gb.status === "done") docxDone = true;
      }
    }
    const min = Math.floor((Date.now() - start) / 60000);
    log(`[${min}m] docx: ${docxProgress}`);
    if (docxDone) { log("=== DOCX GRAPH DONE ==="); break; }
    await new Promise((r) => setTimeout(r, 120000));
  }

  // ── Brainstorm ──
  log(`--- Brainstorm: ${topic} ---`);
  await page.goto("/brainstorm");
  await page.waitForLoadState("networkidle");
  const startBtn = page.locator("button").filter({ hasText: /start conversation|开始对话|开始/i }).first();
  await startBtn.waitFor({ state: "visible", timeout: 15000 });
  await startBtn.click();
  await page.waitForTimeout(3000);

  const sessResp = await page.request.get(`${BASE}/api/v1/brainstorm/sessions`);
  const sessBody = await sessResp.json();
  const sessionId = (sessBody.data || [])[0]?.id;
  log(`Session: ${sessionId}`);

  const msgs = [
    `我想写一份关于${topic}的技术报告，面向开发团队和架构师。`,
    `篇幅约 8000 字，覆盖微服务、容器编排、CI/CD、可观测性四大主题。`,
    `方向：聚焦中型企业的云原生转型实践，强调落地步骤。`,
  ];
  for (let i = 0; i < msgs.length; i++) {
    const ta = page.locator("textarea").first();
    await ta.waitFor({ state: "visible", timeout: 10000 });
    await ta.fill(msgs[i]);
    await ta.press("Enter");
    log(`Msg ${i+1}: ${msgs[i].slice(0,35)}...`);
    await page.waitForTimeout(15000);
  }

  // Trigger outline via API
  log("Triggering outline generation...");
  await page.evaluate(async (sid) => {
    await fetch(`/api/v1/brainstorm/sessions/${sid}/generate-outline`, {
      method: "POST", headers: {"Content-Type":"application/json"}, body: "{}",
    });
  }, sessionId);

  // Poll for outline
  const deadline = Date.now() + 30 * 60 * 1000;
  let outlineReady = false;
  while (Date.now() < deadline) {
    const sd = await page.evaluate(async (sid) => {
      const r = await fetch(`/api/v1/brainstorm/sessions/${sid}`);
      return (await r.json()).data;
    }, sessionId);
    if (sd.outline) {
      log(`Outline ready! sections: ${Array.isArray(sd.outline) ? sd.outline.length : (sd.outline.sections?.length||0)}`);
      outlineReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  if (!outlineReady) { log("ERROR: outline timeout"); await browser.close(); process.exit(1); }

  // Create draft
  const draftResult = await page.evaluate(async (sid) => {
    const r = await fetch("/api/v1/drafts", {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({sessionId: sid}),
    });
    return await r.json();
  }, sessionId);
  const draftId = draftResult.data?.id;
  log(`Draft: ${draftId}`);
  if (!draftId) { log("ERROR: no draft"); await browser.close(); process.exit(1); }

  // Generate 2 sections
  const sections = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/drafts/${id}`);
    return (await r.json()).data.sections.filter((s) => s.parentId === null).slice(0, 2);
  }, draftId);
  log(`Sections: ${sections.map((s) => (s.title||"").slice(0,25)).join(" | ")}`);

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const t = Date.now();
    log(`--- Section ${i+1}: ${(sec.title||"").slice(0,40)} ---`);
    const result = await page.evaluate(async ({id, secId}) => {
      const resp = await fetch(`/api/v1/drafts/${id}/sections/${secId}/generate`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({constraints:{wordLimit:800}}),
      });
      const text = await resp.text();
      let refCount = 0, refTypes = [];
      try {
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ") && line.includes("references")) {
            const data = JSON.parse(line.slice(6));
            if (data.references) { refCount = data.references.length; refTypes = [...new Set(data.references.map((r) => r.sourceType||"rag"))]; }
          }
        }
      } catch {}
      return { status: resp.status, len: text.length, refCount, refTypes };
    }, {id: draftId, secId: sec.id});
    log(`  status=${result.status} len=${result.len} refs=${result.refCount} types=[${result.refTypes.join(",")}] time=${((Date.now()-t)/1000).toFixed(1)}s`);
    await page.evaluate(async ({id, secId}) => {
      await fetch(`/api/v1/drafts/${id}/sections/${secId}/confirm`, {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    }, {id: draftId, secId: sec.id});
    log(`  confirmed`);
  }

  // Regenerate section 1
  log("--- Regenerate section 1 ---");
  await page.evaluate(async ({id, secId}) => {
    await fetch(`/api/v1/drafts/${id}/sections/${secId}/unlock`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({targetStatus:"pending"})});
  }, {id: draftId, secId: sections[0].id});
  const regen = await page.evaluate(async ({id, secId}) => {
    const t = Date.now();
    const resp = await fetch(`/api/v1/drafts/${id}/sections/${secId}/generate`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({constraints:{wordLimit:600}})});
    const text = await resp.text();
    return { status: resp.status, len: text.length, time: ((Date.now()-t)/1000).toFixed(1) };
  }, {id: draftId, secId: sections[0].id});
  log(`  regen: status=${regen.status} len=${regen.len} time=${regen.time}s`);
  await page.evaluate(async ({id, secId}) => {
    await fetch(`/api/v1/drafts/${id}/sections/${secId}/confirm`, {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
  }, {id: draftId, secId: sections[0].id});

  // Verify references
  log("--- Reference verification ---");
  const final = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/drafts/${id}`);
    return (await r.json()).data;
  }, draftId);
  for (const sec of (final.sections||[]).filter((s) => s.parentId === null).slice(0, 2)) {
    const refs = sec.references || [];
    log(`Section ${(sec.title||"").slice(0,30)}: refs=${refs.length} content=${(sec.content||"").length}c`);
    for (const r of refs.slice(0, 2)) {
      log(`  [${r.sourceType||"rag"}] ${(r.documentName||"").slice(0,25)}: ${(r.content||"").slice(0,70)}`);
    }
  }

  log("=== CYCLE 3 COMPLETE ===");
  await browser.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
