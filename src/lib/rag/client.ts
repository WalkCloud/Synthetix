import { spawnPythonJson } from "@/lib/python";

const RAG_MANAGE_SCRIPT = "workers/python/rag_manage.py";

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
  | (RagBaseOptions & { action: "graph" | "core-graph" | "overview-graph"; entityName?: string; depth?: number; maxNodes?: number; minDegree?: number })
  | (RagBaseOptions & { action: "create-entity"; entityName: string; entityType: string; description: string })
  | (RagBaseOptions & { action: "delete-entity"; entityName: string })
  | (RagBaseOptions & { action: "merge-entities"; sources: string; target: string })
  | (RagBaseOptions & { action: "delete-by-doc"; docId: string });

export class RagIndexBusyError extends Error {
  readonly code = "RAG_INDEX_BUSY";
  readonly retryable = true;

  constructor(readonly result: Record<string, unknown>) {
    super("RAG index is busy; document cleanup can be retried after indexing settles");
    this.name = "RagIndexBusyError";
  }
}

export async function manageRag(
  options: RagManageOptions
): Promise<Record<string, unknown>> {
  // Secrets (API keys) are passed via environment variables, NOT argv.
  // argv is visible in process listings (ps/task manager) — env is not.
  const args = [
    "--user-id", options.userId,
    "--action", options.action,
    "--embed-api-base", options.embedConfig.apiBase,
    "--embed-model", options.embedConfig.model,
    "--llm-api-base", options.llmConfig.apiBase,
    "--llm-model", options.llmConfig.model,
  ];

  if (options.embedDim > 0) args.push("--embed-dim", String(options.embedDim));

  if (options.rerankConfig) {
    args.push(
      "--rerank-api-base", options.rerankConfig.apiBase,
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
    case "overview-graph":
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

  const result = await spawnPythonJson<Record<string, unknown>>(RAG_MANAGE_SCRIPT, args, {
    env: {
      RAG_EMBED_API_KEY: options.embedConfig.apiKey,
      RAG_LLM_API_KEY: options.llmConfig.apiKey,
      ...(options.rerankConfig ? { RAG_RERANK_API_KEY: options.rerankConfig.apiKey } : {}),
    },
  });
  if (options.action === "delete-by-doc" && result.status === "busy") {
    throw new RagIndexBusyError(result);
  }
  return result;
}
