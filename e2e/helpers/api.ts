/**
 * 鉴权 API 封装 — 所有 spec 共用的 fetch wrapper。
 *
 * 统一处理：cookie 透传、统一响应信封 { success, data?, error? }、
 * 错误抛出。真实 LLM 环境，不做 mock。
 */
import type { APIRequestContext } from "@playwright/test";

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 带鉴权 cookie 的 GET。 */
export async function apiGet<T = unknown>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const res = await request.get(path);
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok() || !body.success) {
    throw new Error(`GET ${path} failed: HTTP ${res.status()} ${body.error ?? ""}`);
  }
  return body.data as T;
}

/** 带鉴权 cookie 的 POST。 */
export async function apiPost<T = unknown>(
  request: APIRequestContext,
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.post(path, { data });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok() || !body.success) {
    throw new Error(`POST ${path} failed: HTTP ${res.status()} ${body.error ?? ""}`);
  }
  return body.data as T;
}

/** 带鉴权 cookie 的 DELETE。data 可选（query 参数需拼在 path 里）。 */
export async function apiDelete<T = unknown>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const res = await request.delete(path);
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok() || !body.success) {
    throw new Error(`DELETE ${path} failed: HTTP ${res.status()} ${body.error ?? ""}`);
  }
  return body.data as T;
}

/** multipart 文件上传。 */
export async function apiUpload<T = unknown>(
  request: APIRequestContext,
  path: string,
  fields: Record<string, string>,
  filePath: string,
  fileField = "file",
  fileName?: string,
): Promise<T> {
  const name = fileName ?? filePath.split(/[\\/]/).pop() ?? "upload";
  const res = await request.post(path, {
    multipart: {
      ...fields,
      [fileField]: { name, mimeType: "application/octet-stream", buffer: await readBuffer(filePath) },
    },
  });
  const body = (await res.json()) as ApiEnvelope<T>;
  // 上传的 409/重复 是预期分支，不在这里抛错，交给调用方判断
  if (!body.success) {
    return body.data as T; // 重复上传时 data 可能仍带信息
  }
  return body.data as T;
}

async function readBuffer(filePath: string): Promise<Buffer> {
  const fs = await import("fs/promises");
  return fs.readFile(filePath);
}
