/**
 * 写作模块 helper — 草稿创建、SSE 流式生成捕获、节确认。
 *
 * 覆盖测试方案模块 7（写作撰写）。
 * SSE 解析：手动读取 text/event-stream，按 \n\n 分帧，去掉 data: 前缀后 JSON.parse。
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { apiGet, apiPost } from "./api";
import { waitForTask } from "./task-poller";
import { TIMEOUTS } from "./constants";

export interface OutlineSection {
  num: string;
  title: string;
  description?: string;
  keyPoints?: string[];
  estimatedWords?: number;
  children?: OutlineSection[];
}
export interface Outline {
  title: string;
  sections: OutlineSection[];
}

export interface DraftSection {
  id: string;
  index: number;
  num: string;
  title: string;
  status: string;
  content: string | null;
  contentA?: string | null;
  contentB?: string | null;
  selectedModel?: string | null;
  locked?: boolean;
  versions?: unknown[];
}

export interface Draft {
  id: string;
  title: string;
  status: string;
  outline?: string;
  sections?: DraftSection[];
  progress?: { accepted: number; completed: number; total: number };
}

/** 创建草稿（从 outline，自动拆 sections）。 */
export async function createDraft(
  request: APIRequestContext,
  outline: Outline,
): Promise<Draft> {
  return apiPost<Draft>(request, "/api/v1/drafts", { outline });
}

/** 获取草稿详情（含 sections）。 */
export async function getDraft(request: APIRequestContext, draftId: string): Promise<Draft> {
  return apiGet<Draft>(request, `/api/v1/drafts/${draftId}`);
}

/** 删除草稿。 */
export async function deleteDraft(request: APIRequestContext, draftId: string): Promise<void> {
  await apiPost<null>(request, `/api/v1/drafts/${draftId}`, {}).catch(async () => {
    // DELETE 不带 body
    await request.delete(`/api/v1/drafts/${draftId}`);
  });
}

export interface SseCaptureResult {
  events: SseEvent[];
  chunks: string[];
  chunksA: string[];
  chunksB: string[];
  hasReferences: boolean;
  done: boolean;
  error: string | null;
}

/**
 * 捕获单节生成的 SSE 事件流（浏览器内 fetch，自动携带 cookie）。
 *
 * @param page 浏览器页面（需已登录，在同源页面执行）
 */
export async function generateSectionSse(
  page: Page,
  draftId: string,
  sectionId: string,
  timeoutMs = TIMEOUTS.sectionGenerate,
): Promise<SseCaptureResult> {
  return captureSseInBrowser(page, `/api/v1/drafts/${draftId}/sections/${sectionId}/generate`, {}, timeoutMs);
}

/**
 * 捕获 A/B 对比生成的 SSE 事件流。
 * 事件含 source:"a"|"b" 区分两个模型的 chunk。
 */
export async function compareSectionSse(
  page: Page,
  draftId: string,
  sectionId: string,
  modelBConfigId?: string,
  timeoutMs = TIMEOUTS.sectionGenerate,
): Promise<SseCaptureResult> {
  const body: Record<string, unknown> = {};
  if (modelBConfigId) body.modelBConfigId = modelBConfigId;
  return captureSseInBrowser(page, `/api/v1/drafts/${draftId}/sections/${sectionId}/compare`, body, timeoutMs);
}

/**
 * 在浏览器内捕获 SSE：发起 fetch 读流，结果写入 window.__sseResult，
 * 外层 waitForFunction 轮询。浏览器自动携带鉴权 cookie，原生支持流式。
 */
async function captureSseInBrowser(
  page: Page,
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<SseCaptureResult> {
  const resultKey = `__sseResult_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  // 直接在当前页面 evaluate 初始化 key（addInitScript 只对新导航生效）
  await page.evaluate((key) => { (window as unknown as Record<string, unknown>)[key] = null; }, resultKey);

  // fire-and-forget：evaluate 内发起 fetch 读流，结果写入 window[key]，不 await 它
  await page.evaluate(({ url, body, key }) => {
    const w = window as unknown as Record<string, unknown>;
    const events: SseEvent[] = [];
    (async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
          w[key] = { error: `HTTP ${res.status}`, events: [], chunks: [], chunksA: [], chunksB: [], hasReferences: false, done: false };
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of frame.split("\n")) {
              if (line.startsWith("data:")) {
                try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
              }
            }
            if (events.some((e) => e.type === "done" || e.type === "error")) break;
          }
          if (events.some((e) => e.type === "done" || e.type === "error")) break;
        }
        const chunks: string[] = [];
        const chunksA: string[] = [];
        const chunksB: string[] = [];
        for (const e of events) {
          if (e.type === "chunk") {
            const c = String(e.content ?? "");
            if (e.source === "a") chunksA.push(c);
            else if (e.source === "b") chunksB.push(c);
            else chunks.push(c);
          }
        }
        w[key] = {
          events,
          chunks,
          chunksA,
          chunksB,
          hasReferences: events.some((e) => e.type === "references"),
          done: events.some((e) => e.type === "done"),
          error: events.find((e) => e.type === "error")?.error ?? null,
        };
      } catch (e) {
        w[key] = { error: e instanceof Error ? e.message : String(e), events: [], chunks: [], chunksA: [], chunksB: [], hasReferences: false, done: false };
      }
    })();
  }, { url, body, key: resultKey });

  // 轮询 window[key] 非 null（用 evaluate 取值，避免 jsonValue 序列化问题）
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key] !== null, resultKey);
    if (ready) break;
    await page.waitForTimeout(2000);
  }
  const result = (await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], resultKey)) as SseCaptureResult;
  return result;
}

/** 确认节（POST /confirm）。 */
export async function confirmSection(
  request: APIRequestContext,
  draftId: string,
  sectionId: string,
): Promise<DraftSection> {
  return apiPost<DraftSection>(request, `/api/v1/drafts/${draftId}/sections/${sectionId}/confirm`, {});
}

/** 选择 A/B 对比结果（PUT section selectedSource）。 */
export async function selectCompareSource(
  request: APIRequestContext,
  draftId: string,
  sectionId: string,
  source: "a" | "b",
): Promise<DraftSection> {
  const res = await request.put(`/api/v1/drafts/${draftId}/sections/${sectionId}`, {
    data: { selectedSource: source },
  });
  const body = await res.json();
  if (!res.ok() || !body.success) {
    throw new Error(`selectSource failed: HTTP ${res.status()} ${body.error ?? ""}`);
  }
  return body.data as DraftSection;
}

/** 触发整篇生成（异步任务），返回 taskId。 */
export async function generateAllSections(
  request: APIRequestContext,
  draftId: string,
): Promise<string> {
  const data = await apiPost<{ taskId: string }>(request, `/api/v1/drafts/${draftId}/generate-all`, {});
  return data.taskId;
}

/** 导出草稿（markdown/pdf/docx），返回下载内容 Buffer。 */
export async function exportDraft(
  request: APIRequestContext,
  draftId: string,
  format: "markdown" | "pdf" | "docx",
): Promise<{ ok: boolean; status: number; contentType: string; buffer: Buffer | null }> {
  const res = await request.post(`/api/v1/drafts/${draftId}/export`, {
    data: { format },
    timeout: 120_000,
  });
  const contentType = res.headers()["content-type"] ?? "";
  let buffer: Buffer | null = null;
  if (res.ok()) {
    const body = await res.body();
    buffer = Buffer.from(body);
  }
  return { ok: res.ok(), status: res.status(), contentType, buffer };
}
