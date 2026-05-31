"use client";

import { useState, useEffect, useCallback } from "react";
import { CardSelector } from "@/components/shared/card-selector";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[idx]}`;
}

interface DbStats {
  dbType: string;
  isPg: boolean;
  version: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  integrityOk: boolean;
}

function SqliteMonitor() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/system/db-stats");
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-4 w-32 bg-muted-foreground/15 rounded animate-pulse" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 bg-muted-foreground/10 rounded animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return <div className="p-6 text-sm text-muted-foreground">Unable to load database stats.</div>;

  return (
    <div className="p-6 space-y-5">
      {/* File Info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-muted rounded-[12px]">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Database File</div>
          <div className="text-sm font-semibold text-foreground mt-1">{formatBytes(stats.dbSizeBytes)}</div>
        </div>
        {stats.walSizeBytes > 0 && (
          <div className="p-3 bg-muted rounded-[12px]">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">WAL File</div>
            <div className="text-sm font-semibold text-foreground mt-1">{formatBytes(stats.walSizeBytes)}</div>
          </div>
        )}
        {stats.version && (
          <div className="p-3 bg-muted rounded-[12px]">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Version</div>
            <div className="text-sm font-semibold text-foreground mt-1">SQLite {stats.version}</div>
          </div>
        )}
      </div>

      {/* Table Stats */}
      <div>
        <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Status</div>
        <div className="flex items-center gap-3 p-3 bg-muted rounded-[12px]">
          <span className={`w-2.5 h-2.5 rounded-full ${stats.integrityOk ? "bg-emerald-500" : "bg-red-500"}`} />
          <span className="text-[13px] text-foreground font-medium">
            {stats.integrityOk ? "Database integrity verified" : "Integrity check failed"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function DatabaseTab() {
  const [dbType, setDbType] = useState("sqlite");
  const [pgHost, setPgHost] = useState("");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDatabase, setPgDatabase] = useState("");
  const [pgUser, setPgUser] = useState("");
  const [pgPassword, setPgPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dbConnectionUrl, setDbConnectionUrl] = useState("file:./dev.db");
  const [pgConfigured, setPgConfigured] = useState(false);
  const [savingDb, setSavingDb] = useState(false);
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
          setPgConfigured(s.pgConfigured || false);
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
      if (pgPassword) body.pgPassword = pgPassword;
      const res = await fetch("/api/v1/settings/database", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      setDbMsg(d.success ? { type: "success", text: d.data?.note || "Database settings saved" } : { type: "error", text: d.error });
      if (d.success && dbType === "postgresql" && pgHost) {
        setPgConfigured(true);
      }
    } catch {
      setDbMsg({ type: "error", text: "Failed to save" });
    } finally {
      setSavingDb(false);
    }
  }

  const configured = dbType === "sqlite" || !!(pgHost && pgDatabase);
  const activeIsPg = pgConfigured && dbType === "postgresql";

  return (
    <div className="space-y-6">
      {/* Database Type Selector */}
      <div className="bg-card border rounded-[16px]">
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
            <h3 className="text-base font-semibold text-foreground">Database</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${configured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300"}`}>
            <span className={`w-2 h-2 rounded-full ${configured ? "bg-emerald-500" : "bg-amber-500"}`} />
            {configured ? (dbType === "postgresql" ? "PostgreSQL" : "SQLite") : "Not Configured"}
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4">
            <CardSelector
              selected={dbType === "sqlite"}
              onSelect={() => setDbType("sqlite")}
              icon={<div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary/12 text-primary flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg></div>}
              title="SQLite (Local)"
              description="Embedded file-based database. Zero config, works offline."
            />
            <CardSelector
              selected={dbType === "postgresql"}
              onSelect={() => setDbType("postgresql")}
              icon={<div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300 flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg></div>}
              title={configured ? "PostgreSQL" : "PostgreSQL"}
              description={configured ? "Connected to remote PostgreSQL database." : "Configure cloud PostgreSQL for multi-device access."}
            />
          </div>
          <div className="mt-4 p-3 bg-muted rounded-[12px] flex items-center gap-3">
            <svg className="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            <span className="text-[13px] text-muted-foreground">
              Active connection: <span className="font-mono text-foreground text-[12px]">{dbConnectionUrl}</span>
              {dbConnectionUrl.startsWith("file:") ? " — This is your local SQLite database file." : ""}
            </span>
          </div>
        </div>
      </div>

      {/* PostgreSQL Config (only when PG selected in the card) */}
      {dbType === "postgresql" && (
        <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z" /></svg>
              <h3 className="text-base font-semibold text-foreground">PostgreSQL Configuration</h3>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Host</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" placeholder="localhost" value={pgHost} onChange={(e) => setPgHost(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Port</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" placeholder="5432" value={pgPort} onChange={(e) => setPgPort(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Database</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" placeholder="synthetix" value={pgDatabase} onChange={(e) => setPgDatabase(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Username</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" placeholder="postgres" value={pgUser} onChange={(e) => setPgUser(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Password</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} className="w-full px-3.5 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" placeholder="Enter PostgreSQL password" value={pgPassword} onChange={(e) => setPgPassword(e.target.value)} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" tabIndex={-1}>
                    {showPassword ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={saveDatabase} disabled={savingDb} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm disabled:opacity-50 cursor-pointer">
                {savingDb ? "Saving..." : "Save Database Settings"}
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

      {/* SQLite Monitor Panel */}
      {!activeIsPg && (
        <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
              <h3 className="text-base font-semibold text-foreground">SQLite Monitor</h3>
            </div>
          </div>
          <SqliteMonitor />
        </div>
      )}
    </div>
  );
}
