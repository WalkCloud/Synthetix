/**
 * 模型 helper — 读取现有 provider 与默认模型 id。
 * 模型管理只读：不新增/不删除/不改默认，绝不污染用户配置。
 */
import type { APIRequestContext } from "@playwright/test";
import { apiGet } from "./api";

interface ProviderModel {
  id: string;
  modelName: string;
  capabilities?: string;
  embeddingDim?: number | null;
  isDefaultFor?: string | null;
}
interface Provider {
  id: string;
  name: string;
  models: ProviderModel[];
}

/** 解析 capabilities 字段为数组（与页面 parseCapabilities 对齐）。
 *  字段可能是 JSON 字符串、数组、或逗号分隔字符串。 */
function parseCaps(caps?: string | string[] | null): string[] {
  if (!caps) return [];
  if (Array.isArray(caps)) return caps;
  if (typeof caps !== "string") return [];
  try {
    const v = JSON.parse(caps);
    return Array.isArray(v) ? v : [];
  } catch {
    return caps.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

/** 获取所有 provider 及其模型。 */
export async function getProviders(request: APIRequestContext): Promise<Provider[]> {
  return apiGet<Provider[]>(request, "/api/v1/models/providers");
}

/** 获取默认 LLM 与嵌入模型 id（用于上传参数）。 */
export async function getDefaultModelIds(request: APIRequestContext): Promise<{
  llmModelId?: string;
  embedModelId?: string;
  llmModels: ProviderModel[];
  embedModels: ProviderModel[];
}> {
  const providers = await getProviders(request);
  const llmModels: ProviderModel[] = [];
  const embedModels: ProviderModel[] = [];
  for (const p of providers ?? []) {
    for (const m of p.models ?? []) {
      const caps = parseCaps(m.capabilities as string | string[] | null | undefined);
      if (caps.includes("embedding") || caps.includes("embed")) {
        embedModels.push(m);
      } else if (caps.includes("chat")) {
        llmModels.push(m);
      }
    }
  }
  const llmModelId = (llmModels.find((m) => m.isDefaultFor === "llm") ?? llmModels[0])?.id;
  const embedModelId =
    (embedModels.find((m) => m.isDefaultFor === "embedding") ?? embedModels[0])?.id;
  return { llmModelId, embedModelId, llmModels, embedModels };
}
