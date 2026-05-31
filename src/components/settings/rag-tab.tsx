"use client";

import { useState, useEffect } from "react";
import { CardSelector } from "@/components/shared/card-selector";

type RagVectorDb = "local" | "pgvector" | "milvus" | "qdrant";

export function RagTab() {
  const [ragVectorDb, setRagVectorDb] = useState<RagVectorDb>("local");
  const [ragPgHost, setRagPgHost] = useState("");
  const [ragPgPort, setRagPgPort] = useState("5432");
  const [ragPgDatabase, setRagPgDatabase] = useState("");
  const [ragPgUser, setRagPgUser] = useState("");
  const [ragPgPassword, setRagPgPassword] = useState("");
  const [ragNeo4jUri, setRagNeo4jUri] = useState("");
  const [ragNeo4jUser, setRagNeo4jUser] = useState("");
  const [ragNeo4jPassword, setRagNeo4jPassword] = useState("");
  const [ragMilvusUri, setRagMilvusUri] = useState("");
  const [ragMilvusToken, setRagMilvusToken] = useState("");
  const [ragMilvusUser, setRagMilvusUser] = useState("");
  const [ragMilvusPassword, setRagMilvusPassword] = useState("");
  const [ragMilvusDbName, setRagMilvusDbName] = useState("");
  const [ragQdrantUrl, setRagQdrantUrl] = useState("");
  const [ragQdrantApiKey, setRagQdrantApiKey] = useState("");
  const [savingRag, setSavingRag] = useState(false);
  const [ragConfigured, setRagConfigured] = useState(true);
  const [ragMsg, setRagMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/v1/settings/rag")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const s = data.data;
          setRagVectorDb(s.ragVectorDb || "local");
          setRagPgHost(s.ragPgHost || "");
          setRagPgPort(String(s.ragPgPort || "5432"));
          setRagPgDatabase(s.ragPgDatabase || "");
          setRagPgUser(s.ragPgUser || "");
          setRagPgPassword(s.ragPgPassword || "");
          setRagNeo4jUri(s.ragNeo4jUri || "");
          setRagNeo4jUser(s.ragNeo4jUser || "");
          setRagNeo4jPassword(s.ragNeo4jPassword || "");
          setRagMilvusUri(s.ragMilvusUri || "");
          setRagMilvusToken(s.ragMilvusToken || "");
          setRagMilvusUser(s.ragMilvusUser || "");
          setRagMilvusPassword(s.ragMilvusPassword || "");
          setRagMilvusDbName(s.ragMilvusDbName || "");
          setRagQdrantUrl(s.ragQdrantUrl || "");
          setRagQdrantApiKey(s.ragQdrantApiKey || "");
          const vdb = s.ragVectorDb || "local";
          setRagConfigured(
            vdb === "local"
            || (vdb === "pgvector" && !!s.ragPgHost)
            || (vdb === "milvus" && !!s.ragMilvusUri)
            || (vdb === "qdrant" && !!s.ragQdrantUrl),
          );
        }
      })
      .catch(() => {});
  }, []);

  async function saveRag() {
    setSavingRag(true);
    setRagMsg(null);
    try {
      const res = await fetch("/api/v1/settings/rag", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ragVectorDb,
          ragPgHost, ragPgPort: parseInt(ragPgPort, 10), ragPgDatabase, ragPgUser, ragPgPassword,
          ragNeo4jUri, ragNeo4jUser, ragNeo4jPassword,
          ragMilvusUri, ragMilvusToken, ragMilvusUser, ragMilvusPassword, ragMilvusDbName,
          ragQdrantUrl, ragQdrantApiKey,
        }),
      });
      const d = await res.json();
      setRagMsg(d.success ? { type: "success", text: "Vector database settings saved. Restart server to apply." } : { type: "error", text: d.error });
    } catch {
      setRagMsg({ type: "error", text: "Failed to save" });
    } finally {
      setSavingRag(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
            <h3 className="text-base font-semibold text-foreground">Vector Database Provider</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${ragConfigured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300"}`}>
            <span className={`w-2 h-2 rounded-full ${ragConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
            {ragConfigured
              ? (ragVectorDb === "pgvector" ? "pgvector (PostgreSQL)" : ragVectorDb === "milvus" ? "Milvus" : ragVectorDb === "qdrant" ? "Qdrant" : "Local (NanoVectorDB)")
              : "Not Configured"}
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4">
            <CardSelector
              selected={ragVectorDb === "local"}
              onSelect={() => { setRagVectorDb("local"); setRagConfigured(true); }}
              icon={<div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary/12 text-primary flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg></div>}
              title="Local (NanoVectorDB)"
              description="Default local vector storage. Zero configuration, works offline."
            />
            <CardSelector
              selected={ragVectorDb === "pgvector"}
              onSelect={() => { setRagVectorDb("pgvector"); setRagConfigured(!!ragPgHost); }}
              icon={<div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300 flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg></div>}
              title="pgvector (PostgreSQL)"
              description="Production-grade vector search using PostgreSQL + pgvector extension."
            />
            <CardSelector
              selected={ragVectorDb === "milvus"}
              onSelect={() => { setRagVectorDb("milvus"); setRagConfigured(!!ragMilvusUri); }}
              icon={<div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-950/35 text-orange-600 dark:text-orange-400 flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg></div>}
              title="Milvus"
              description="High-performance vector database for billion-scale similarity search."
            />
            <CardSelector
              selected={ragVectorDb === "qdrant"}
              onSelect={() => { setRagVectorDb("qdrant"); setRagConfigured(!!ragQdrantUrl); }}
              icon={<div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/35 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></div>}
              title="Qdrant"
              description="Rust-based vector search engine with rich filtering and quantization."
            />
          </div>
        </div>
      </div>

      {ragVectorDb === "pgvector" && (
        <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
              <h3 className="text-base font-semibold text-foreground">PostgreSQL / pgvector Configuration</h3>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Host</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="localhost" value={ragPgHost} onChange={(e) => setRagPgHost(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Port</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="5432" value={ragPgPort} onChange={(e) => setRagPgPort(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Database</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="synthetix_rag" value={ragPgDatabase} onChange={(e) => setRagPgDatabase(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Username</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="postgres" value={ragPgUser} onChange={(e) => setRagPgUser(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Password</label>
              <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter password" value={ragPgPassword} onChange={(e) => setRagPgPassword(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {ragVectorDb === "milvus" && (
        <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
              <h3 className="text-base font-semibold text-foreground">Milvus Configuration</h3>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Milvus URI</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="http://localhost:19530" value={ragMilvusUri} onChange={(e) => setRagMilvusUri(e.target.value)} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Token (Optional)</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter authentication token" value={ragMilvusToken} onChange={(e) => setRagMilvusToken(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Username (Optional)</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="root" value={ragMilvusUser} onChange={(e) => setRagMilvusUser(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Password (Optional)</label>
                <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter password" value={ragMilvusPassword} onChange={(e) => setRagMilvusPassword(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Database Name</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="default" value={ragMilvusDbName} onChange={(e) => setRagMilvusDbName(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {ragVectorDb === "qdrant" && (
        <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <h3 className="text-base font-semibold text-foreground">Qdrant Configuration</h3>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Qdrant URL</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="http://localhost:6333" value={ragQdrantUrl} onChange={(e) => setRagQdrantUrl(e.target.value)} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">API Key (Optional)</label>
              <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter API key" value={ragQdrantApiKey} onChange={(e) => setRagQdrantApiKey(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {ragVectorDb !== "local" && (
      <div className="bg-card border rounded-[16px]">
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            <h3 className="text-base font-semibold text-foreground">Neo4j Graph Storage (Optional)</h3>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-[13px] text-muted-foreground">Optional graph database for entity relationship storage. Only needed for &quot;graph&quot; index mode.</p>
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Neo4j URI</label>
            <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="bolt://localhost:7687" value={ragNeo4jUri} onChange={(e) => setRagNeo4jUri(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Username</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="neo4j" value={ragNeo4jUser} onChange={(e) => setRagNeo4jUser(e.target.value)} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Password</label>
              <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter password" value={ragNeo4jPassword} onChange={(e) => setRagNeo4jPassword(e.target.value)} />
            </div>
          </div>
        </div>
      </div>
      )}

      {ragVectorDb !== "local" && (
      <div className="bg-card border rounded-[16px]">
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            <h3 className="text-base font-semibold text-foreground">Save Configuration</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="flex gap-3">
            <button type="button" onClick={saveRag} disabled={savingRag} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm disabled:opacity-50">
              {savingRag ? "Saving..." : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                  Save Vector DB Settings
                </>
              )}
            </button>
            {ragMsg && (
              <div className={`flex items-center text-sm ${ragMsg.type === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {ragMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
