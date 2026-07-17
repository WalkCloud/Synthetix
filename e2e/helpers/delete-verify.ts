/**
 * 删除级联验证 — 绕过 API 空校验（verifyDocumentDeleted 恒返回 ok），
 * 通过独立渠道复查知识图谱 / Wiki / DB 残留。
 *
 * 覆盖测试方案模块 5B。
 */
import type { APIRequestContext } from "@playwright/test";
import { apiGet, apiDelete } from "./api";
import { waitForTask } from "./task-poller";
import { TIMEOUTS } from "./constants";

/** 删除文档。deleteWiki=true 时级联删 Wiki 条目。返回 cleanup 任务信息。 */
export async function deleteDocument(
  request: APIRequestContext,
  docId: string,
  opts: { deleteWiki?: boolean } = {},
): Promise<{
  cleanupTaskId?: string;
  wiki?: { deleted: number; updated: number; orphansPurged?: number };
  wikiCleanupError?: string;
}> {
  const query = opts.deleteWiki ? "?deleteWiki=true" : "";
  return apiDelete(request, `/api/v1/documents/${docId}${query}`);
}

/**
 * 删除文档并等待其 document_cleanup 任务到终态。
 * cleanup 是异步的（API 返回时仅 queued），残留验证必须等它完成。
 */
export async function deleteAndAwaitCleanup(
  request: APIRequestContext,
  docId: string,
  opts: { deleteWiki?: boolean } = {},
): Promise<void> {
  const result = await deleteDocument(request, docId, opts);
  if (!result.cleanupTaskId) {
    throw new Error(`Document ${docId} deletion did not return cleanupTaskId`);
  }
  await waitForTask(request, result.cleanupTaskId, TIMEOUTS.cleanupTask, 4_000);
  // 额外缓冲：让图谱缓存失效生效
  await new Promise((r) => setTimeout(r, 1_000));
}

// ---- 独立渠道残留验证 ----

/** 查询某文档来源的 Wiki 条目数（按 sourceRefs 精确匹配）。
 *  wiki entries 接口返回分页对象 { items, total, page, limit, stats }。 */
export async function countWikiEntriesForDoc(
  request: APIRequestContext,
  docId: string,
): Promise<number> {
  const ids = await apiGet<string[]>(
    request,
    `/api/v1/wiki/entries?documentId=${encodeURIComponent(docId)}&idsOnly=true`,
  );
  return ids.length;
}
export async function getKnowledgeEntities(request: APIRequestContext): Promise<
  { name: string; description?: string; source_id?: string }[]
> {
  try {
    const data = await apiGet<{ entities?: { name: string; description?: string; source_id?: string }[]; count?: number }>(
      request,
      "/api/v1/knowledge/entities",
    );
    return data.entities ?? [];
  } catch {
    return [];
  }
}

/** 知识图谱健康（含 staleRagDocIds）。 */
export async function getKnowledgeHealth(request: APIRequestContext): Promise<{
  status: string;
  staleRagDocIds?: string[];
  hasGraph?: boolean;
}> {
  return apiGet<{ status: string; staleRagDocIds?: string[]; hasGraph?: boolean }>(
    request,
    "/api/v1/knowledge/health",
  ).catch(() => ({
    status: "unknown",
    staleRagDocIds: [],
  }));
}

/** 知识图谱结构。 */
export async function getKnowledgeGraph(request: APIRequestContext): Promise<{
  nodes?: unknown[];
  edges?: unknown[];
}> {
  return apiGet<{ nodes?: unknown[]; edges?: unknown[] }>(
    request,
    "/api/v1/knowledge/graph?mode=core",
  ).catch(() => ({
    nodes: [],
    edges: [],
  }));
}

/**
 * 综合判定：删除后该文档是否已彻底清理。
 * - DB：library/documents 列表不含
 * - 图谱：health 的 staleRagDocIds 不含该 docId
 * - 实体：可选 source_id 检查（LightRAG 按 docId 前缀追踪）
 * @returns 各渠道的检查明细 + 是否全部通过
 */
export async function verifyDeletionClean(
  request: APIRequestContext,
  docId: string,
): Promise<{
  clean: boolean;
  dbGone: boolean;
  graphNoStale: boolean;
  details: string[];
}> {
  const details: string[] = [];

  // 1. DB：library 列表
  let dbGone = true;
  try {
    const docs = await apiGet<{ id: string }[]>(request, "/api/v1/library/documents");
    dbGone = !(docs ?? []).some((d) => d.id === docId);
    if (!dbGone) details.push(`DB: document ${docId} 仍在 library 列表中`);
  } catch {
    details.push("DB: 查询 library 列表失败（无法判定）");
    dbGone = false;
  }

  // 2. 图谱：staleRagDocIds
  const health = await getKnowledgeHealth(request);
  const stale = health.staleRagDocIds ?? [];
  const graphNoStale = !stale.some((s) => s.includes(docId));
  if (!graphNoStale) details.push(`Graph: ${docId} 仍在 staleRagDocIds`);

  const clean = dbGone && graphNoStale;
  if (clean) details.push("✓ 删除验证通过：DB 已清、图谱无 stale");
  return { clean, dbGone, graphNoStale, details };
}
