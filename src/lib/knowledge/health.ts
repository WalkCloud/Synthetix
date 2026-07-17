import fs from "fs";
import path from "path";
import { resolveRagRoot } from "@/lib/rag/paths";
import { withUserRagLock } from "@/lib/rag/mutation-lock";

const DOCUMENT_ROOT = process.env.DOCUMENT_ROOT || "./data/documents";
const RAG_ROOT = resolveRagRoot();

export interface KnowledgeHealthInput {
  userId: string;
  activeDocumentIds: string[];
  documentRoot?: string;
  ragRoot?: string;
}

export interface KnowledgeHealth {
  status: "healthy" | "dirty";
  documentsInDb: number;
  documentDirs: number;
  staleDocumentDirs: string[];
  ragDocStatusEntries: number;
  staleRagDocIds: string[];
  hasGraph: boolean;
  staleLocks: string[];
}

function safeReadDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isRecordForActiveDocument(key: string, value: unknown, activeIds: Set<string>): boolean {
  const directDocId = key.split("/")[0];
  if (activeIds.has(directDocId)) return true;
  if (!key.startsWith("dup-") || !value || typeof value !== "object") return false;
  const metadata = (value as { metadata?: { original_doc_id?: string } }).metadata;
  const originalDocId = metadata?.original_doc_id?.split("/")[0];
  return Boolean(originalDocId && activeIds.has(originalDocId));
}

export async function scanKnowledgeHealth(input: KnowledgeHealthInput): Promise<KnowledgeHealth> {
  const documentRoot = input.documentRoot || DOCUMENT_ROOT;
  const ragRoot = input.ragRoot || RAG_ROOT;
  const activeIds = new Set(input.activeDocumentIds);
  const userDocumentDir = path.join(documentRoot, input.userId);
  const userRagDir = path.join(ragRoot, input.userId);

  const documentDirs = safeReadDir(userDocumentDir).filter((entry) => {
    const full = path.join(userDocumentDir, entry);
    return fs.existsSync(full) && fs.statSync(full).isDirectory();
  });
  const staleDocumentDirs = documentDirs.filter((entry) => !activeIds.has(entry));

  const docStatus = readJsonObject(path.join(userRagDir, "kv_store_doc_status.json"));
  const staleRagDocIds = Object.entries(docStatus)
    .filter(([key, value]) => !isRecordForActiveDocument(key, value, activeIds))
    .map(([key]) => key)
    .sort();

  const graphPath = path.join(userRagDir, "graph_chunk_entity_relation.graphml");
  const hasGraph = fs.existsSync(graphPath) && fs.statSync(graphPath).size > 0;
  const staleLocks = safeReadDir(userRagDir).filter((entry) => entry.endsWith(".lock") || entry === ".indexing.lock");

  const dirty = staleDocumentDirs.length > 0 || staleRagDocIds.length > 0 || staleLocks.length > 0 || (activeIds.size === 0 && hasGraph);

  return {
    status: dirty ? "dirty" : "healthy",
    documentsInDb: activeIds.size,
    documentDirs: documentDirs.length,
    staleDocumentDirs,
    ragDocStatusEntries: Object.keys(docStatus).length,
    staleRagDocIds,
    hasGraph,
    staleLocks,
  };
}

export async function resetUserKnowledgeBase(input: { userId: string; documentRoot?: string; ragRoot?: string }): Promise<void> {
  const documentRoot = input.documentRoot || DOCUMENT_ROOT;
  const ragRoot = input.ragRoot || RAG_ROOT;
  // The RAG workspace rm -rf MUST be gated behind the per-user mutation lock
  // so it cannot race an in-flight Python writer (graph index / embed /
  // delete-by-doc) holding the same lock. The document-root deletion is
  // per-document and does not touch shared RAG storage, so it stays outside
  // the lock to avoid needlessly serializing unrelated file ops.
  fs.rmSync(path.join(documentRoot, input.userId), { recursive: true, force: true });
  await withUserRagLock(input.userId, "node-reset-knowledge-base", async () => {
    const userRagDir = path.join(ragRoot, input.userId);
    fs.rmSync(userRagDir, { recursive: true, force: true });
    fs.mkdirSync(userRagDir, { recursive: true });
  });
}
