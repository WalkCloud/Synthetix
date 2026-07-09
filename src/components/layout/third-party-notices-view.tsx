"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Copy, Download, ChevronRight, ArrowLeft, Package } from "lucide-react";
import { useLocale } from "@/lib/i18n";

type ThirdPartyNotice = {
  name: string;
  version: string;
  license: string;
  homepage?: string;
  repository?: string;
  source: string;
  copyright?: string[];
  licenseText?: string;
};

type CoreComponent = {
  name: string;
  package: string;
  category: string;
  description: { en: string; zh: string };
};

const SOURCES = ["npm", "python", "electron", "asset", "runtime"] as const;

export function ThirdPartyNoticesView() {
  const { t, locale } = useLocale();
  const tt = t.legal;
  const isZh = locale === "zh-CN";

  const [entries, setEntries] = useState<ThirdPartyNotice[] | null>(null);
  const [coreComponents, setCoreComponents] = useState<CoreComponent[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSource, setActiveSource] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/legal/third-party-notices.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: ThirdPartyNotice[]) => setEntries(d))
      .catch(() => setLoadError(true));
    // Load the curated core-components manifest (static, version-controlled).
    fetch("/legal/core-components.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: CoreComponent[]) => setCoreComponents(Array.isArray(d) ? d : []))
      .catch(() => setCoreComponents([]));
  }, []);

  // Build a lookup so core components can show resolved version + license.
  const byName = useMemo(() => {
    const m = new Map<string, ThirdPartyNotice>();
    entries?.forEach((e) => m.set(e.name.toLowerCase(), e));
    return m;
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeSource !== "all" && e.source !== activeSource) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.license.toLowerCase().includes(q) ||
        (e.homepage ?? "").toLowerCase().includes(q)
      );
    });
  }, [entries, query, activeSource]);

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function copyAll() {
    try {
      const res = await fetch("/legal/THIRD-PARTY-NOTICES.txt", { cache: "no-store" });
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }

  const sourceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    entries?.forEach((e) => {
      c[e.source] = (c[e.source] ?? 0) + 1;
    });
    return c;
  }, [entries]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 space-y-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {tt.back}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{tt.title}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{tt.intro}</p>
      </div>

      {/* Core open-source components — curated, scannable highlights */}
      {coreComponents.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-1 text-base font-medium">{tt.coreTitle}</h2>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{tt.coreIntro}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {coreComponents.map((c) => {
              const resolved = byName.get(c.package.toLowerCase());
              const desc = isZh ? c.description.zh : c.description.en;
              return (
                <div
                  key={c.package}
                  className="rounded-lg border border-border bg-background p-3.5"
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    {resolved && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {resolved.version}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
                  {resolved && (
                    <span className="mt-2 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {resolved.license}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Complete dependency list */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-medium">{tt.fullListTitle}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tt.fullListIntro}</p>
        </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tt.searchPlaceholder}
            className="w-full rounded-lg border border-input bg-background py-2 pr-3 pl-9 text-[13px] shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          onClick={copyAll}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <Copy className="size-4" />
          {copied ? tt.copied : tt.copyAll}
        </button>
        <a
          href="/legal/THIRD-PARTY-NOTICES.txt"
          download
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <Download className="size-4" />
          {tt.download}
        </a>
      </div>

      {/* Source filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip
          active={activeSource === "all"}
          onClick={() => setActiveSource("all")}
          label={tt.all}
          count={entries?.length ?? 0}
        />
        {SOURCES.filter((s) => (sourceCounts[s] ?? 0) > 0).map((s) => (
          <FilterChip
            key={s}
            active={activeSource === s}
            onClick={() => setActiveSource(s)}
            label={s}
            count={sourceCounts[s] ?? 0}
          />
        ))}
      </div>

      {/* Content */}
      {loadError || (entries && entries.length === 0) ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Package className="mx-auto mb-2 size-6 opacity-50" />
          {loadError ? tt.empty : tt.noResults}
        </div>
      ) : !entries ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{tt.loading}</div>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {tt.total.replace("{n}", String(filtered.length))}
          </p>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{tt.package}</th>
                  <th className="px-3 py-2 text-left font-medium">{tt.version}</th>
                  <th className="px-3 py-2 text-left font-medium">{tt.license}</th>
                  <th className="px-3 py-2 text-left font-medium">{tt.source}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const isOpen = expanded.has(e.name);
                  const url = e.homepage || e.repository;
                  return (
                    <Fragment key={e.name}>
                      <tr
                        onClick={() => toggle(e.name)}
                        className="cursor-pointer border-t hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 font-medium">
                          <span className="inline-flex items-center gap-1">
                            <ChevronRight
                              className={`size-3.5 shrink-0 transition-transform ${
                                isOpen ? "rotate-90" : ""
                              }`}
                            />
                            {e.name}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {e.version}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                            {e.license}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{e.source}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t bg-muted/20">
                          <td colSpan={4} className="px-3 py-3">
                            <div className="space-y-2 pl-5">
                              {url && (
                                <div>
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-primary hover:underline"
                                  >
                                    {url}
                                  </a>
                                </div>
                              )}
                              {e.copyright && e.copyright.length > 0 && (
                                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                                  {e.copyright.join("\n")}
                                </pre>
                              )}
                              {e.licenseText && (
                                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs">
                                  {e.licenseText}
                                </pre>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      </section>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {label} <span className="opacity-60">({count})</span>
    </button>
  );
}
