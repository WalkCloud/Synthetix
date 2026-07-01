/**
 * 异步任务轮询 — Synthetix 多数核心流程是"提交任务→轮询→完成"。
 *
 * 任务持久化在 async_tasks 表，状态：pending → running → completed | failed | cancelled。
 */
import type { APIRequestContext } from "@playwright/test";
import { apiGet } from "./api";

export interface AsyncTask {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  type?: string;
  errorMessage?: string | null;
}

/** 查询单个任务状态。 */
export async function getTask(
  request: APIRequestContext,
  taskId: string,
): Promise<AsyncTask> {
  return apiGet<AsyncTask>(request, `/api/v1/tasks/${taskId}`);
}

/**
 * 轮询任务直到终态（completed/failed/cancelled）。
 * @returns 最终任务对象
 * @throws 任务失败或超时
 */
export async function waitForTask(
  request: APIRequestContext,
  taskId: string,
  timeoutMs: number,
  intervalMs = 5_000,
): Promise<AsyncTask> {
  const deadline = Date.now() + timeoutMs;
  let last: AsyncTask | null = null;
  while (Date.now() < deadline) {
    try {
      last = await getTask(request, taskId);
      if (last.status === "completed") return last;
      if (last.status === "failed" || last.status === "cancelled") {
        throw new Error(
          `Task ${taskId} ended as ${last.status}: ${last.errorMessage ?? ""}`,
        );
      }
    } catch (e) {
      // 临时网络错误（dev 重新编译）可重试；但任务失败要往上抛
      if (e instanceof Error && /ended as/.test(e.message)) throw e;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `Task ${taskId} timed out after ${timeoutMs}ms (last status: ${last?.status ?? "unknown"}, progress ${last?.progress ?? 0})`,
  );
}

/** 列出某类型的最近任务，用于查找 document_cleanup 等。 */
export async function findLatestTaskByType(
  request: APIRequestContext,
  type: string,
): Promise<AsyncTask | null> {
  const list = await apiGet<AsyncTask[] | { tasks: AsyncTask[] }>(
    request,
    "/api/v1/tasks",
  ).catch(() => null);
  const tasks = Array.isArray(list) ? list : list?.tasks ?? [];
  // 最近的在前（按 id 降序近似，或接口已排序）
  return tasks.find((t) => t.type === type) ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
