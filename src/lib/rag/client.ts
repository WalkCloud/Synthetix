import path from "path";
import { decrypt } from "@/lib/crypto";
import { spawnPythonJson } from "@/lib/python";
import { normalizeProviderBaseUrl } from "@/lib/llm/provider-endpoints";

const RAG_MANAGE_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_manage.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

export interface EmbedConfig {
  apiBase: string;
  apiKey: string;
  model: string;
}

export interface RagManageOptions {
  userId: string;
  action: string;
  keyword?: string;
  entityName?: string;
  entityType?: string;
  description?: string;
  field?: string;
  value?: string;
  sources?: string;
  target?: string;
  docId?: string;
  depth?: number;
  maxNodes?: number;
  minDegree?: number;
  limit?: number;
  embedDim: number;
  embedConfig: EmbedConfig;
  llmConfig: EmbedConfig;
}

export function buildConfig(model: {
  provider: { apiBaseUrl: string; apiKey: string | null };
  modelId: string;
}): EmbedConfig {
  return {
    apiBase: normalizeProviderBaseUrl(model.provider.apiBaseUrl),
    apiKey: decrypt(model.provider.apiKey || ""),
    model: model.modelId,
  };
}

export async function manageRag(
  options: RagManageOptions
): Promise<Record<string, unknown>> {
  const args = [
    "--user-id", options.userId,
    "--action", options.action,
    "--embed-api-base", options.embedConfig.apiBase,
    "--embed-api-key", options.embedConfig.apiKey,
    "--embed-model", options.embedConfig.model,
    "--llm-api-base", options.llmConfig.apiBase,
    "--llm-api-key", options.llmConfig.apiKey,
    "--llm-model", options.llmConfig.model,
  ];

  if (options.embedDim > 0) args.push("--embed-dim", String(options.embedDim));
  if (options.keyword) args.push("--keyword", options.keyword);
  if (options.entityName) args.push("--entity-name", options.entityName);
  if (options.entityType) args.push("--entity-type", options.entityType);
  if (options.description) args.push("--description", options.description);
  if (options.field) args.push("--field", options.field);
  if (options.value) args.push("--value", options.value);
  if (options.sources) args.push("--sources", options.sources);
  if (options.target) args.push("--target", options.target);
  if (options.docId) args.push("--doc-id", options.docId);
  if (options.depth) args.push("--depth", String(options.depth));
  if (options.maxNodes) args.push("--max-nodes", String(options.maxNodes));
  if (options.minDegree) args.push("--min-degree", String(options.minDegree));
  if (options.limit) args.push("--limit", String(options.limit));

  return spawnPythonJson(RAG_MANAGE_SCRIPT, args);
}
