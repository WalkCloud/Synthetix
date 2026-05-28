"use client";

import { useState, useEffect } from "react";
import { CardSelector } from "@/components/shared/card-selector";
import { MigrationsTab } from "@/components/settings/migrations-tab";

export function DatabaseTab() {
  const [dbType, setDbType] = useState("sqlite");
  const [pgHost, setPgHost] = useState("");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDatabase, setPgDatabase] = useState("");
  const [pgUser, setPgUser] = useState("");
  const [dbConnectionUrl, setDbConnectionUrl] = useState("file:./dev.db");
  const [savingDb, setSavingDb] = useState(false);
  const [dbConfigured, setDbConfigured] = useState(true);
  const [dbMsg, setDbMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/v1/settings/database")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const s = data.data;
          setDbType(s.dbType || "sqlite");
          setPgHost(s.pgHost || "");
          setPgPort(String(s.pgPort || "5432"));
          setPgDatabase(s.pgDatabase || "");
          setPgUser(s.pgUser || "");
          setDbConnectionUrl(s.connectionUrl || "file:./dev.db");
          setDbConfigured(s.dbType === "sqlite" || !!s.pgHost);
        }
      })
      .catch(() => {});
  }, []);

  async function saveDatabase() {
    setSavingDb(true);
    setDbMsg(null);
    try {
      const body: Record<string, unknown> = { dbType };
      if (pgHost) body.pgHost = pgHost;
      if (pgPort) body.pgPort = parseInt(pgPort, 10);
      if (pgDatabase) body.pgDatabase = pgDatabase;
      if (pgUser) body.pgUser = pgUser;
      const res = await fetch("/api/v1/settings/database", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      setDbMsg(d.success ? { type: "success", text: `${d.data?.note || "Database settings saved"}` } : { type: "error", text: d.error });
    } catch {
      setDbMsg({ type: "error", text: "Failed to save" });
    } finally {
      setSavingDb(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-[16px]">
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
            <h3 className="text-base font-semibold text-foreground">Database Type</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${dbConfigured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300"}`}>
            <span className={`w-2 h-2 rounded-full ${dbConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
            {dbConfigured ? (dbType === "postgresql" ? "PostgreSQL" : "SQLite") : "Not Configured"}
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4">
            <CardSelector
              selected={dbType === "sqlite"}
              onSelect={() => { setDbType("sqlite"); setDbConfigured(true); }}
              icon={<div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary/12 text-primary flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg></div>}
              title="SQLite (Local)"
              description="Embedded file-based database. Zero configuration, works offline. Best for single-user deployment."
            />
            <CardSelector
              selected={dbType === "postgresql"}
              onSelect={() => { setDbType("postgresql"); setDbConfigured(!!pgHost); }}
              icon={<div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300 flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg></div>}
              title="PostgreSQL"
              description="Production-grade relational database. Best for team collaboration and cloud deployment."
            />
          </div>
          <div className="mt-4 p-3 bg-muted rounded-[12px] flex items-center gap-3">
            <svg className="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            <span className="text-[13px] text-muted-foreground">
              Current connection: <span className="font-mono text-foreground">{dbConnectionUrl}</span>
              {dbType === "postgresql"
                ? " — Changes require a server restart to take effect."
                : " — To switch to PostgreSQL, fill in the fields below and restart the server."}
            </span>
          </div>
        </div>
      </div>

      {dbType !== "sqlite" && (
      <div className="bg-card border rounded-[16px]">
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z" /></svg>
            <h3 className="text-base font-semibold text-foreground">Database Configuration</h3>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {dbType === "postgresql" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Host</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="localhost" value={pgHost} onChange={(e) => setPgHost(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Port</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="5432" value={pgPort} onChange={(e) => setPgPort(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Database</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="synthetix" value={pgDatabase} onChange={(e) => setPgDatabase(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Username</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="postgres" value={pgUser} onChange={(e) => setPgUser(e.target.value)} />
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={saveDatabase} disabled={savingDb} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm disabled:opacity-50">
              {savingDb ? "Saving..." : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                  Save Database Settings
                </>
              )}
            </button>
            {dbMsg && (
              <div className={`flex items-center text-sm ${dbMsg.type === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {dbMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      <MigrationsTab />
    </div>
  );
}
