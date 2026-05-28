"use client";

import { useState, useEffect } from "react";

interface MigrationEntry {
  migration_name: string;
  finished_at: string | null;
  rolled_back_at: string | null;
}

function MigrationHistory() {
  const [migrations, setMigrations] = useState<MigrationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/system/migrations")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setMigrations(data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading migrations...</div>;
  }

  if (migrations.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">No migrations found. Run migrations to initialize the database schema.</div>;
  }

  return (
    <div className="border rounded-[16px] overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted">
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Migration</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Status</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Applied</th>
          </tr>
        </thead>
        <tbody>
          {migrations.map((m) => {
            const applied = m.finished_at && !m.rolled_back_at;
            return (
              <tr key={m.migration_name} className="border-b last:border-0 hover:bg-primary-50">
                <td className="px-4 py-3 text-[13px] font-mono">{m.migration_name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${applied ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300" : "bg-orange-100 dark:bg-orange-950/35 text-orange-600 dark:text-orange-400"}`}>
                    {applied ? "Applied" : "Pending"}
                  </span>
                </td>
                <td className="px-4 py-3 text-[13px] text-muted-foreground">
                  {m.finished_at ? new Date(m.finished_at).toLocaleString() : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MigrationsTab() {
  return (
    <div className="bg-card border rounded-[16px]">
      <div className="flex items-center justify-between px-6 py-5 border-b">
        <div className="flex items-center gap-2.5">
          <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
          <h3 className="text-base font-semibold text-foreground">Database Migration</h3>
        </div>
      </div>
      <div className="p-6">
        <div className="flex gap-3 mb-5">
          <button type="button" className="flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-secondary/70 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            Run Migrations
          </button>
          <button type="button" className="flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-secondary/70 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Export Schema
          </button>
        </div>
        <div className="text-sm font-semibold mb-3">Migration History</div>
        <MigrationHistory />
      </div>
    </div>
  );
}
