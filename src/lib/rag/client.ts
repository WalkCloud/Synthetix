import { spawn } from "child_process";
import path from "path";
import { decrypt } from "@/lib/crypto";
import type {
  EntityListResult,
  EntityDetailResult,
  KnowledgeGraphSubgraph,
  ManageResult,
} from "@/types/knowledge";

const RAG_MANAGE_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_manage.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

interface EmbedConfig {
  apiBase: string;
  apiKey: string;
  model: string;
}

interface RagManageOptions {
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
  limit?: number;
  embedDim: number;
  embedConfig: EmbedConfig;
  llmConfig: EmbedConfig;
}

export function buildConfig(model: {
  provider: { apiBaseUrl: string; apiKey: string | null };
  modelId: string;
}): EmbedConfig {
  const base = model.provider.apiBaseUrl
    .replace(/\/embeddings?$/, "")
    .replace(/\/chat\/completions$/, "");
  return {
    apiBase: base,
    apiKey: decrypt(model.provider.apiKey || ""),
    model: model.modelId,
  };
}

function spawnRagManage(options: RagManageOptions): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = [
      RAG_MANAGE_SCRIPT,
      "--user-id", options.userId,
      "--action", options.action,
      "--embed-api-base", options.embedConfig.apiBase,
      "--embed-api-key", options.embedConfig.apiKey,
      "--embed-model", options.embedConfig.model,
      "--llm-api-base", options.llmConfig.apiBase,
      "--llm-api-key", options.llmConfig.apiKey,
      "--llm-model", options.llmConfig.model,
    ];

    if (options.embedDim > 0) {
      args.push("--embed-dim", String(options.embedDim));
    }
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
    if (options.limit) args.push("--limit", String(options.limit));

    const proc = spawn(PYTHON_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`RAG manage failed: ${stderr || stdout || `code ${code}`}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || "{}"));
      } catch {
        resolve({});
      }
    });
    proc.on("error", (err: Error) => reject(err));
  });
}

export async function listEntities(
  userId: string,
  embedConfig: EmbedConfig,
  llmConfig: EmbedConfig,
  embedDim = 0,
  keyword?: string,
  limit = 50,
): Promise<EntityListResult> {
  const result = await spawnRagManage({
    userId, action: "entities", embedConfig, llmConfig, embedDim, keyword, limit,
  });
  return result as unknown as EntityListResult;
}

export async function getEntityDetail(
  userId: string,
  embedConfig: EmbedConfig,
  llmConfig: EmbedConfig,
  embedDim = 0,
  entityName: string,
  maxDepth = 2,
  maxNodes = 100,
): Promise<EntityDetailResult> {
  const result = await spawnRagManage({
    userId, action: "entity-detail", embedConfig, llmConfig, embedDim,
    entityName, depth: maxDepth, maxNodes,
  });
  return result as unknown as EntityDetailResult;
}

export async function exportSubgraph(
  userId: string,
  embedConfig: EmbedConfig,
  llmConfig: EmbedConfig,
  embedDim = 0,
  entityName?: string,
  depth = 2,
  maxNodes = 100,
): Promise<KnowledgeGraphSubgraph> {
  const result = await spawnRagManage({
    userId, action: "graph", embedConfig, llmConfig, embedDim,
    entityName, depth, maxNodes,
  });
  return result as unknown as KnowledgeGraphSubgraph;
}

export async function deleteDocumentFromRag(
  userId: string,
  embedConfig: EmbedConfig,
  llmConfig: EmbedConfig,
  embedDim = 0,
  docId?: string,
): Promise<ManageResult> {
  const result = await spawnRagManage({
    userId, action: "delete-by-doc", embedConfig, llmConfig, embedDim, docId,
  });
  return result as unknown as ManageResult;
}

export async function createEntity(
  userId: string,
  embedConfig: EmbedConfig,
  llmConfig: EmbedConfig,
  embedDim = 0,
  entityName?: string,
  entityType?: string,
  description?: string,
): Promise<ManageResult> {
  const result = await spawnRagManage({
    userId, action: "create-entity", embedConfig, llmConfig, embedDim,
    entityName, entityType, description,
  });
  return result as unknown as ManageResult;
}

export async function deleteEntity(
  userId: string,
  embedConfig: EmbedConfig,
  llmConfig: EmbedConfig,
  embedDim = 0,
  entityName?: string,
): Promise<ManageResult> {
  const result = await spawnRagManage({
    userId, action: "delete-entity", embedConfig, llmConfig, embedDim, entityName,
  });
  return result as unknown as ManageResult;
}

export async function mergeEntities(
  userId: string,
  embedConfig: EmbedConfig,
  llmConfig: EmbedConfig,
  embedDim = 0,
  sources?: string[],
  target?: string,
): Promise<ManageResult> {
  const result = await spawnRagManage({
    userId, action: "merge-entities", embedConfig, llmConfig, embedDim,
    sources: sources?.join(","), target,
  });
  return result as unknown as ManageResult;
}
