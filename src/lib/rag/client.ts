import path from "path";
import { spawnPythonJson } from "@/lib/python";

const RAG_MANAGE_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_manage.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

export interface EmbedConfig {
  apiBase: string;
  apiKey: string;
  model: string;
}

interface RagBaseOptions {
  userId: string;
  embedDim: number;
  embedConfig: EmbedConfig;
  llmConfig: EmbedConfig;
  rerankConfig?: EmbedConfig;
}

export type RagManageOptions =
  | (RagBaseOptions & { action: "entities"; keyword?: string; limit?: number })
  | (RagBaseOptions & { action: "entity-detail"; entityName: string; depth?: number; maxNodes?: number })
  | (RagBaseOptions & { action: "graph" | "core-graph"; entityName?: string; depth?: number; maxNodes?: number; minDegree?: number })
  | (RagBaseOptions & { action: "create-entity"; entityName: string; entityType: string; description: string })
  | (RagBaseOptions & { action: "delete-entity"; entityName: string })
  | (RagBaseOptions & { action: "merge-entities"; sources: string; target: string })
  | (RagBaseOptions & { action: "delete-by-doc"; docId: string });

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

  if (options.rerankConfig) {
    args.push(
      "--rerank-api-base", options.rerankConfig.apiBase,
      "--rerank-api-key", options.rerankConfig.apiKey,
      "--rerank-model", options.rerankConfig.model,
    );
  }

  switch (options.action) {
    case "entities":
      if (options.keyword) args.push("--keyword", options.keyword);
      if (options.limit) args.push("--limit", String(options.limit));
      break;
    case "entity-detail":
      args.push("--entity-name", options.entityName);
      if (options.depth) args.push("--depth", String(options.depth));
      if (options.maxNodes) args.push("--max-nodes", String(options.maxNodes));
      break;
    case "graph":
    case "core-graph":
      if (options.entityName) args.push("--entity-name", options.entityName);
      if (options.depth) args.push("--depth", String(options.depth));
      if (options.maxNodes) args.push("--max-nodes", String(options.maxNodes));
      if (options.minDegree) args.push("--min-degree", String(options.minDegree));
      break;
    case "create-entity":
      args.push("--entity-name", options.entityName, "--entity-type", options.entityType, "--description", options.description);
      break;
    case "delete-entity":
      args.push("--entity-name", options.entityName);
      break;
    case "merge-entities":
      args.push("--sources", options.sources, "--target", options.target);
      break;
    case "delete-by-doc":
      args.push("--doc-id", options.docId);
      break;
  }

  return spawnPythonJson(RAG_MANAGE_SCRIPT, args);
}
