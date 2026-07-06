/**
 * 文档处理 helper — 上传、开始处理、轮询流水线阶段、效率计时。
 *
 * 覆盖测试方案模块 5（基础流水线）与 5A（四模式一致性 + 效率对比）。
 */
import type { APIRequestContext } from "@playwright/test";
import { apiGet, apiPost, apiUpload } from "./api";
import { waitForTask } from "./task-poller";
import { modeToOptions, type KnowledgeMode, TIMEOUTS } from "./constants";

export interface DocumentMeta {
  id: string;
  status: string;
  originalName: string;
  pipeline?: {
    stages: { key: string; status: string; progress: number | null }[];
    branches: { key: string; status: string; progress: number | null }[];
    isProcessing: boolean;
    isReady: boolean;
    isBasicReady: boolean;
    isFailed: boolean;
    graphMode: boolean;
  };
}

export interface UploadedDoc {
  document: { id: string; originalName: string };
  duplicate?: boolean;
}

/** 上传文档（multipart），返回 docId。 */
export async function uploadDocument(
  request: APIRequestContext,
  filePath: string,
  extra: { llmModelId?: string; embedModelId?: string; mode?: KnowledgeMode } = {},
): Promise<{ docId: string; duplicate: boolean }> {
  const opts = modeToOptions(extra.mode ?? "standard");
  const fields: Record<string, string> = {
    splitStrategy: opts.splitStrategy,
    indexTarget: opts.indexTarget,
    indexMode: opts.indexMode,
    autoSplit: String(opts.autoSplit),
  };
  if (extra.llmModelId) fields.llmModelId = extra.llmModelId;
  if (extra.embedModelId) fields.embedModelId = extra.embedModelId;

  const res = await request.post("/api/v1/documents/upload", {
    multipart: {
      ...fields,
      file: {
        name: filePath.split(/[\\/]/).pop() ?? "upload.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: await (await import("fs/promises")).readFile(filePath),
      },
    },
  });
  const body = await res.json();
  if (!body.success) {
    // 重复上传（SHA256 命中）返回 DUPLICATE，交给调用方判断
    if (body.error === "DUPLICATE") {
      return { docId: body.data?.document?.id ?? "", duplicate: true };
    }
    throw new Error(`Upload failed: HTTP ${res.status()} ${body.error ?? ""}`);
  }
  return { docId: body.data.document.id, duplicate: false };
}

/** 对已上传文档提交 reprocess（开始处理），返回 taskId。 */
export async function startProcessing(
  request: APIRequestContext,
  docId: string,
  opts: { mode?: KnowledgeMode; llmModelId?: string; embedModelId?: string } = {},
): Promise<{ taskId: string; deduped: boolean }> {
  const modeOpts = modeToOptions(opts.mode ?? "standard");
  const data = await apiPost<{ documentId: string; taskId: string; deduped?: boolean }>(
    request,
    `/api/v1/documents/${docId}/reprocess`,
    {
      options: {
        llmModelId: opts.llmModelId,
        embedModelId: opts.embedModelId,
        splitStrategy: modeOpts.splitStrategy,
        indexTarget: modeOpts.indexTarget,
        indexMode: modeOpts.indexMode,
        wikiEnabled: modeOpts.wikiEnabled,
        autoSplit: modeOpts.autoSplit,
      },
    },
  );
  return { taskId: data.taskId, deduped: !!data.deduped };
}

/** 读取文档详情（含 pipeline 进度）。 */
export async function getDocument(
  request: APIRequestContext,
  docId: string,
): Promise<DocumentMeta> {
  return apiGet<DocumentMeta>(request, `/api/v1/library/documents/${docId}`);
}

/**
 * 端到端：上传 + 开始处理 + 等到 ready。
 *
 * 幂等：若文档已存在（SHA256 去重命中），先删除已有文档再重传，
 * 确保用例可重复执行且每次都是全新处理。
 *
 * 注意：full/graph/wiki 模式的 doc.status=ready 依赖整条任务链
 * (document_convert → rag_embed_index[+graph] → wiki_synthesize)，
 * 而非单个 convert 任务。因此这里轮询 doc.status 到 ready，
 * 而非只等单个 taskId（convert completed ≠ doc ready）。
 *
 * @returns { docId, taskId, elapsedMs } 用于效率对比。
 */
export async function uploadAndProcessToReady(
  request: APIRequestContext,
  filePath: string,
  mode: KnowledgeMode,
  modelIds: { llmModelId?: string; embedModelId?: string },
  timeoutMs?: number,
): Promise<{ docId: string; taskId: string; elapsedMs: number; duplicate: boolean }> {
  const isBig = mode === "full";
  const timeout = timeoutMs ?? (isBig ? TIMEOUTS.bigDocProcess : TIMEOUTS.smallDocProcess);

  const t0 = Date.now();
  let { docId, duplicate } = await uploadDocument(request, filePath, { mode, ...modelIds });
  if (duplicate) {
    // 已存在：复用该 docId 直接 reprocess（startProcessing 会取消旧任务、清 chunks、
    // 重新走完整流水线）。避免"删后重传"——因为 cleanup 是异步的（10min settle），
    // 立即重传会再次撞 SHA256 去重。reprocess 保证用例每次都拿到全新处理结果。
    if (!docId) {
      throw new Error("文档重复且无 docId 可复用");
    }
  }
  const { taskId } = await startProcessing(request, docId, { mode, ...modelIds });
  // 直接轮询 doc.status 到 ready（覆盖完整任务链 + graph/wiki 分支）
  await waitForStatus(request, docId, ["ready"], timeout);
  return { docId, taskId, elapsedMs: Date.now() - t0, duplicate };
}

/** 轮询文档直到 status 命中目标值。 */
export async function waitForStatus(
  request: APIRequestContext,
  docId: string,
  targetStatuses: string[],
  timeoutMs: number,
  intervalMs = 4_000,
): Promise<DocumentMeta> {
  const deadline = Date.now() + timeoutMs;
  let last: DocumentMeta | null = null;
  while (Date.now() < deadline) {
    try {
      last = await getDocument(request, docId);
      if (targetStatuses.includes(last.status)) return last;
    } catch {
      /* dev 重新编译，重试 */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Document ${docId} did not reach ${targetStatuses.join("/")} within ${timeoutMs}ms (last: ${last?.status})`,
  );
}

/**
 * 轮询直到流水线到达指定阶段状态。
 * 用于验证阶段单调推进（PIPE-05）与中间态（PIPE-03 basicReady）。
 */
export async function waitForPipelineCondition(
  request: APIRequestContext,
  docId: string,
  predicate: (p: DocumentMeta["pipeline"]) => boolean,
  timeoutMs: number,
  intervalMs = 3_000,
): Promise<DocumentMeta["pipeline"]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const doc = await getDocument(request, docId);
      if (doc.pipeline && predicate(doc.pipeline)) return doc.pipeline;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Pipeline condition not met within ${timeoutMs}ms for doc ${docId}`);
}
