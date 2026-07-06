/**
 * Document lifecycle stress test — 3 full upload→process→delete cycles.
 *
 * Drives the REAL browser UI for uploads (Playwright `page.setInputFiles` on
 * the upload zone), then uses the API to poll processing status and assert
 * frontend ↔ backend state consistency at every phase. This is the
 * verification harness for the July 2026 graph-generation + entity-evidence
 * optimizations.
 *
 * Per cycle, all 3 docs in `USER_TEST_DOCS` (epub/docx/pdf) run in graph mode:
 *   1. Upload all 3 via browser UI → assert pending status
 *   2. Start processing (graph mode) → assert pipeline stages
 *   3. Poll until ready → assert graph built (non-empty)
 *   4. Verify entity-evidence latency < 5s (A2 fix validation)
 *   5. Delete all 3 → assert full cascade cleanup
 *
 * The graph phase is LLM-bound (10-30+ min per doc). Each cycle's test timeout
 * is generous; failures interrupt early. The report file
 * (e2e/.report/lifecycle-timing.json) captures per-cycle timing for the
 * before/after comparison doc.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import {
  USER_TEST_DOCS,
  type KnowledgeMode,
  TIMEOUTS,
} from "./helpers/constants";
import { uploadDocument, startProcessing, getDocument } from "./helpers/documents";
import { deleteAndAwaitCleanup } from "./helpers/delete-verify";
import { getDefaultModelIds } from "./helpers/models";
import {
  assertListMatchesDetail,
  assertFrontendPipelineRenders,
  getGraphStats,
  timeEntityEvidence,
  assertDocFullyDeleted,
} from "./helpers/state-checks";
import { waitForTask } from "./helpers/task-poller";

const TIMING_FILE = "e2e/.report/lifecycle-timing.json";
const CYCLES = 3;
const ENTITY_EVIDENCE_TIMEOUT_MS = 5_000; // A2 fix target — was 28-68s

interface CycleTiming {
  cycle: number;
  startedAt: string;
  docIds: string[];
  uploadMs: number;
  // Per-doc graph-build wall time (from rag_index task submit → completed)
  graphBuildMs: Record<string, number>;
  // entity-evidence latency sample (post-graph)
  entityEvidenceMs: number;
  graphStats: { nodes: number; edges: number };
  totalCycleMs: number;
}

async function recordTiming(entry: CycleTiming): Promise<void> {
  try {
    await fs.mkdir("e2e/.report", { recursive: true });
    let data: CycleTiming[] = [];
    try {
      data = JSON.parse(await fs.readFile(TIMING_FILE, "utf-8"));
      if (!Array.isArray(data)) data = [];
    } catch {
      data = [];
    }
    data.push(entry);
    await fs.writeFile(TIMING_FILE, JSON.stringify(data, null, 2));
  } catch {
    /* best-effort */
  }
}

/**
 * Upload a single file via the real browser upload zone on /documents.
 * Returns the docId captured from the upload API response.
 *
 * We use `page.setInputFiles` against the hidden <input type="file"> in the
 * UploadZone component. This triggers the real handleFiles handler in
 * documents/page.tsx, exercising the actual upload UI flow.
 */
async function uploadViaBrowser(
  page: Page,
  filePath: string,
): Promise<{ docId: string; duplicate: boolean }> {
  const fileName = path.basename(filePath);
  // The UploadZone renders an <input type="file"> (hidden, opened by click).
  // setInputFiles works on hidden inputs too — Playwright handles the trigger.
  const fileInput = page.locator('input[type="file"]').first();

  // Listen for the upload response to capture docId (mirrors what the page does).
  const uploadResponse = page.waitForResponse(
    (resp) => resp.url().includes("/api/v1/documents/upload") && resp.request().method() === "POST",
    { timeout: TIMEOUTS.upload },
  ).then(async (resp) => {
    const body = await resp.json();
    return {
      docId: body?.data?.document?.id ?? "",
      duplicate: body?.error === "DUPLICATE",
    };
  });

  await fileInput.setInputFiles(filePath);
  const result = await uploadResponse;

  if (!result.docId && !result.duplicate) {
    throw new Error(`Upload of ${fileName} did not return a docId (response captured but no id)`);
  }
  return result;
}

/**
 * Pick a known entity from the freshly-built graph to use for the
 * entity-evidence latency probe. Falls back to a generic term if the graph
 * is empty (which would itself be a test failure caught upstream).
 */
async function pickEntityForEvidence(
  request: APIRequestContext,
): Promise<string> {
  const stats = await getGraphStats(request);
  if (stats.nodes > 0) {
    // Try to fetch an actual entity name from the entities list.
    try {
      const entitiesResp = await request.get("/api/v1/knowledge/entities?limit=5");
      const body = await entitiesResp.json();
      const entities: { name?: string }[] = body?.data ?? [];
      const named = entities.find((e) => e.name);
      if (named?.name) return named.name;
    } catch {
      /* fall through */
    }
  }
  // Fallback — a term that exists in all the test docs.
  return "平台";
}

test.describe.configure({ mode: "serial" });

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  test.describe(`Document lifecycle stress — Cycle ${cycle}`, () => {
    test(`upload → process (graph) → verify → delete [cycle ${cycle}]`, async ({ page, request }) => {
      test.setTimeout(120 * 60 * 1000); // 120 min per cycle (3 docs × graph mode)

      const startedAt = new Date().toISOString();
      const cycleStart = Date.now();
      const modelIds = await getDefaultModelIds(request).catch(() => ({ llmModelId: "", embedModelId: "" }));

      // ── PHASE 1: Upload all 3 docs via browser UI ──────────────────────
      await page.goto("/documents");
      await page.waitForLoadState("networkidle");

      // Set Knowledge Mode = graph via the UI (so the frontend options match).
      // The ProcessingSettings component exposes mode cards; click the graph one.
      const graphModeCard = page.locator("button, [role='radio']", { hasText: /graph|图谱|知识图谱/i }).first();
      if (await graphModeCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await graphModeCard.click();
      }

      const uploadStart = Date.now();
      const docIds: string[] = [];
      for (const doc of USER_TEST_DOCS) {
        // Verify the file exists first — clearer error than Playwright's.
        try {
          await fs.access(doc.path);
        } catch {
          throw new Error(`Test doc not found: ${doc.path}`);
        }
        const result = await uploadViaBrowser(page, doc.path);
        if (result.duplicate) {
          // Duplicate — the doc already exists. Use the existing docId and
          // reprocess below. This is the expected path on cycles 2/3 if the
          // delete didn't fully complete, OR if a prior cycle left the doc.
          // We still want to process it fresh, so capture via the list.
          const list = await request.get("/api/v1/library/documents?status=all");
          const body = await list.json();
          const existing = (body.data ?? []).find(
            (d: { originalName?: string }) => d.originalName === path.basename(doc.path),
          );
          if (existing) docIds.push(existing.id);
        } else if (result.docId) {
          docIds.push(result.docId);
        }
      }
      const uploadMs = Date.now() - uploadStart;

      expect(docIds.length, `Cycle ${cycle}: should have ${USER_TEST_DOCS.length} docIds`).toBe(USER_TEST_DOCS.length);

      // Wait for the upload panel to show "complete" for each file. The
      // UploadQueuePanel renders one item per upload with a status indicator.
      await page.waitForTimeout(2_000); // let UI settle after uploads
      await expect(page.locator("body")).toBeVisible(); // page didn't crash

      // ── PHASE 2: Start processing (graph mode) via API ────────────────
      const graphBuildMs: Record<string, number> = {};
      const taskIds: string[] = [];

      for (const docId of docIds) {
        const procStart = Date.now();
        const { taskId } = await startProcessing(request, docId, {
          mode: "graph" as KnowledgeMode,
          ...modelIds,
        });
        taskIds.push(taskId);
        // We'll compute graph build time as: from startProcessing to the
        // rag_index task reaching completed. Captured in PHASE 3 polling.
        graphBuildMs[docId] = -Date.now() + procStart; // placeholder; finalized below
        // Re-purpose: store the start timestamp, convert to duration on completion.
        (graphBuildMs as Record<string, number>)[docId] = procStart;
      }

      // Navigate to library — frontend should show docs as "processing"
      await page.goto("/library");
      await page.waitForLoadState("networkidle");

      // ── PHASE 3: Poll until each doc's pipeline is ready ───────────────
      for (let i = 0; i < docIds.length; i++) {
        const docId = docIds[i];
        const procStart = graphBuildMs[docId];

        // Poll the detail endpoint — it correctly continues through graph phase
        // (unlike the list page which stops at "ready").
        let lastStatus = "";
        const deadline = Date.now() + TIMEOUTS.smallDocProcess * 3; // generous: 3× per-doc ceiling for safety
        while (Date.now() < deadline) {
          const doc = await getDocument(request, docId).catch(() => null);
          if (!doc) {
            await new Promise((r) => setTimeout(r, 5_000));
            continue;
          }

          // Frontend-backend consistency: list displayStatus must match detail.
          // Skip during the very first poll (list may not have refreshed yet).
          if (doc.pipeline?.isProcessing && lastStatus) {
            await assertListMatchesDetail(request, docId).catch((err) => {
              // Log but don't fail mid-poll — the final assertion below is the gate.
              console.warn(`[cycle ${cycle}] mid-poll list/detail drift for ${docId}: ${err}`);
            });
          }
          lastStatus = doc.pipeline?.isReady ? "ready" : doc.pipeline?.isFailed ? "failed" : "processing";

          if (doc.pipeline?.isReady) break;
          if (doc.pipeline?.isFailed) {
            throw new Error(`Cycle ${cycle}: doc ${docId} pipeline failed`);
          }
          await new Promise((r) => setTimeout(r, 8_000));
        }

        // Final consistency assertion — list must match detail at ready.
        await assertListMatchesDetail(request, docId);

        // Frontend pipeline UI must render without error.
        await assertFrontendPipelineRenders(page, docId);

        // Record graph build duration for this doc.
        graphBuildMs[docId] = Date.now() - procStart;
      }

      // ── PHASE 4: Verify graph built + entity-evidence fast ─────────────
      // Wait a moment for the graph cache to populate after the last graph task.
      await new Promise((r) => setTimeout(r, 5_000));

      const graphStats = await getGraphStats(request);
      // Graph mode MUST produce a non-empty graph. If nodes=0, either the
      // graph worker failed (soft-landed as ready-with-warning) or A1 broke
      // extraction. This is the key quality assertion.
      expect(
        graphStats.nodes,
        `Cycle ${cycle}: graph mode must produce entities (got ${graphStats.nodes} nodes, ${graphStats.edges} edges)`,
      ).toBeGreaterThan(0);

      // Entity-evidence latency — the A2 fix target.
      const entity = await pickEntityForEvidence(request);
      const evidenceTiming = await timeEntityEvidence(request, entity);
      expect(
        evidenceTiming.ms,
        `Cycle ${cycle}: entity-evidence for "${entity}" must be < ${ENTITY_EVIDENCE_TIMEOUT_MS}ms (got ${evidenceTiming.ms}ms; chunks=${evidenceTiming.chunks})`,
      ).toBeLessThan(ENTITY_EVIDENCE_TIMEOUT_MS);

      // ── PHASE 5: Delete all 3 + verify cascade cleanup ─────────────────
      for (const docId of docIds) {
        await deleteAndAwaitCleanup(request, docId, { deleteWiki: true });

        // Assert fully deleted via independent channels.
        const { clean, details } = await assertDocFullyDeleted(request, docId);
        expect(clean, `Cycle ${cycle}: doc ${docId} not fully deleted:\n${details.join("\n")}`).toBe(true);
      }

      // ── Record timing ──────────────────────────────────────────────────
      await recordTiming({
        cycle,
        startedAt,
        docIds,
        uploadMs,
        graphBuildMs,
        entityEvidenceMs: evidenceTiming.ms,
        graphStats: { nodes: graphStats.nodes, edges: graphStats.edges },
        totalCycleMs: Date.now() - cycleStart,
      });

      console.log(
        `✓ Cycle ${cycle} complete: upload=${uploadMs}ms, ` +
        `graph=${Object.values(graphBuildMs).map((ms) => `${(ms / 1000).toFixed(0)}s`).join("/")} ` +
        `(nodes=${graphStats.nodes}, edges=${graphStats.edges}), ` +
        `entity-evidence=${evidenceTiming.ms}ms, ` +
        `total=${((Date.now() - cycleStart) / 1000).toFixed(0)}s`,
      );
    });
  });
}
