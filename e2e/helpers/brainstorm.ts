/**
 * 头脑风暴 helper — 会话管理、发消息、生成大纲。
 * 覆盖测试方案模块 6（头脑风暴）。
 */
import type { APIRequestContext } from "@playwright/test";
import { apiGet, apiPost, apiDelete } from "./api";
import { waitForTask } from "./task-poller";
import { TIMEOUTS } from "./constants";

export type BrainstormPhase =
  | "gathering"
  | "direction"
  | "mode_select"
  | "section_refine"
  | "ready_to_generate"
  | "ready";

export interface BrainstormSession {
  id: string;
  title: string;
  status: string;
  phase?: string;
  _count?: { messages: number };
}

export interface BrainstormMessage {
  id: string;
  role: string;
  content: string;
}

/** 创建头脑风暴会话。 */
export async function createSession(
  request: APIRequestContext,
  title = "[E2E] 测试会话",
): Promise<BrainstormSession> {
  return apiPost<BrainstormSession>(request, "/api/v1/brainstorm/sessions", { title });
}

/** 列出会话。 */
export async function listSessions(request: APIRequestContext): Promise<BrainstormSession[]> {
  return apiGet<BrainstormSession[]>(request, "/api/v1/brainstorm/sessions");
}

/** 获取会话详情（含消息）。 */
export async function getSession(
  request: APIRequestContext,
  sessionId: string,
): Promise<BrainstormSession & { messages?: BrainstormMessage[] }> {
  return apiGet(request, `/api/v1/brainstorm/sessions/${sessionId}`);
}

/**
 * 发消息给 AI。
 * @returns { userMessage, message(AI回复|null), marker }
 */
export async function sendMessage(
  request: APIRequestContext,
  sessionId: string,
  content: string,
  opts: { clientMarker?: string; phase?: BrainstormPhase } = {},
): Promise<{ userMessage: BrainstormMessage; message: BrainstormMessage | null; marker: string | null }> {
  return apiPost(request, `/api/v1/brainstorm/sessions/${sessionId}/message`, {
    content,
    ...opts,
  });
}

/**
 * 触发生成大纲（异步任务），返回 taskId。
 * 幂等：同 session 已有 pending/running 的 outline_generate 任务返回已存在 taskId。
 */
export async function generateOutline(
  request: APIRequestContext,
  sessionId: string,
): Promise<string> {
  const data = await apiPost<{ taskId: string }>(
    request,
    `/api/v1/brainstorm/sessions/${sessionId}/generate-outline`,
    {},
  );
  return data.taskId;
}

/** 删除会话。 */
export async function deleteSession(request: APIRequestContext, sessionId: string): Promise<void> {
  await apiDelete<null>(request, `/api/v1/brainstorm/sessions/${sessionId}`).catch(async () => {
    await request.delete(`/api/v1/brainstorm/sessions/${sessionId}`);
  });
}
