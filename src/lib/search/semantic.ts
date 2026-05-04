import { spawn } from "child_process";
import path from "path";
import type { SearchResult } from "@/types/documents";

const RAG_QUERY_SCRIPT = path.resolve("workers/python/rag_query.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

export async function semanticSearch(
  query: string,
  userId: string,
  limit = 20
): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_PATH, [
      RAG_QUERY_SCRIPT,
      "--user-id", userId,
      "--query", query,
      "--mode", "hybrid",
      "--limit", String(limit),
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code: number | null) => {
      if (code === 0) {
        const trimmed = stdout.trim();
        if (!trimmed) { resolve([]); return; }
        try {
          const parsed = JSON.parse(trimmed);
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          resolve([{
            chunkId: "",
            documentId: "",
            documentName: "",
            title: null,
            content: trimmed.slice(0, 500),
            score: 0,
          }]);
        }
      } else {
        reject(new Error(`LightRAG query failed: ${stderr || stdout}`));
      }
    });

    proc.on("error", (err: Error) => {
      reject(new Error(`LightRAG spawn failed: ${err.message}`));
    });
  });
}
