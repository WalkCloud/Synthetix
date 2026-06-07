import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { scanKnowledgeHealth, resetUserKnowledgeBase } from "@/lib/knowledge/health";

const TEST_ROOT = path.join("/tmp", "synthetix-knowledge-health");
const DOCUMENT_ROOT = path.join(TEST_ROOT, "documents");
const RAG_ROOT = path.join(TEST_ROOT, "rag");

describe("knowledge health", () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("detects stale document directories and stale RAG state when DB has no documents", async () => {
    const userId = "user-1";
    fs.mkdirSync(path.join(DOCUMENT_ROOT, userId, "doc-stale"), { recursive: true });
    fs.mkdirSync(path.join(RAG_ROOT, userId), { recursive: true });
    fs.writeFileSync(path.join(RAG_ROOT, userId, ".indexing.lock"), "doc-stale");
    fs.writeFileSync(path.join(RAG_ROOT, userId, "graph_chunk_entity_relation.graphml"), "<graphml><node id=\"A\" /></graphml>");
    fs.writeFileSync(path.join(RAG_ROOT, userId, "kv_store_doc_status.json"), JSON.stringify({
      "doc-stale/chunk_000": { status: "processed" },
      "dup-1": { metadata: { original_doc_id: "doc-stale/chunk_001" } },
    }));

    const health = await scanKnowledgeHealth({
      userId,
      documentRoot: DOCUMENT_ROOT,
      ragRoot: RAG_ROOT,
      activeDocumentIds: [],
    });

    expect(health.status).toBe("dirty");
    expect(health.documentsInDb).toBe(0);
    expect(health.documentDirs).toBe(1);
    expect(health.staleDocumentDirs).toEqual(["doc-stale"]);
    expect(health.ragDocStatusEntries).toBe(2);
    expect(health.staleRagDocIds).toEqual(["doc-stale/chunk_000", "dup-1"]);
    expect(health.hasGraph).toBe(true);
    expect(health.staleLocks).toEqual([".indexing.lock"]);
  });

  it("resets user document and RAG directories", async () => {
    const userId = "user-1";
    fs.mkdirSync(path.join(DOCUMENT_ROOT, userId, "doc-stale"), { recursive: true });
    fs.mkdirSync(path.join(RAG_ROOT, userId), { recursive: true });
    fs.writeFileSync(path.join(RAG_ROOT, userId, "kv_store_doc_status.json"), "{}");

    await resetUserKnowledgeBase({ userId, documentRoot: DOCUMENT_ROOT, ragRoot: RAG_ROOT });

    expect(fs.existsSync(path.join(DOCUMENT_ROOT, userId))).toBe(false);
    expect(fs.existsSync(path.join(RAG_ROOT, userId))).toBe(true);
    expect(fs.readdirSync(path.join(RAG_ROOT, userId))).toEqual([]);
  });
});
