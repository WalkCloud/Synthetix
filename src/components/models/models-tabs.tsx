"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "@/lib/i18n";
import { ProviderForm } from "./provider-form";
import { ModelListTab } from "./model-list-tab";
import type { Provider, UsageData } from "./types";

type Tab = "llm" | "embedding" | "rerank" | "image" | "usage";
type TimeRange = "today" | "week" | "month";
type DefaultSlot = "llm" | "embedding" | "rerank" | "image";

const TIME_RANGE_TO_DAYS: Record<TimeRange, number> = {
  today: 1,
  week: 7,
  month: 30,
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function ModelsTabs() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("usage");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; connected: boolean; contextWindows?: Record<string, number>; embeddingDims?: Record<string, number>; error?: string; embedDimErrors?: string[] } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [timeRange, setTimeRange] = useState<TimeRange>("month");
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [trendsData, setTrendsData] = useState<{ total: Array<{ date: string; input: number; output: number }>; byModule: Record<string, Array<{ date: string; input: number; output: number }>>; summary: { totalInput: number; totalOutput: number; totalCalls: number; days: number } } | null>(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/models/providers");
      const data = await res.json();
      if (data.success) setProviders(data.data);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  const fetchUsage = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/v1/models/usage?days=${days}`);
      const data = await res.json();
      if (data.success) setUsageData(data.data);
    } catch {}
  }, []);

  const fetchTrends = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/v1/models/usage/trends?days=${days}`);
      const data = await res.json();
      if (data.success) setTrendsData(data.data);
    } catch {}
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  const usageDays = TIME_RANGE_TO_DAYS[timeRange];

  useEffect(() => {
    if (tab === "usage") {
      fetchUsage(usageDays);
      fetchTrends(usageDays);
    }
  }, [tab, usageDays, fetchUsage, fetchTrends]);

  async function handleTest(id: string) {
    setTestingId(id);
    setTestResult(null);
    const start = Date.now();
    try {
      const res = await fetch(`/api/v1/models/providers/${id}/test`, { method: "POST" });
      const data = await res.json();
      const elapsed = Date.now() - start;
      if (elapsed < 800) await new Promise((r) => setTimeout(r, 800 - elapsed));
      if (data.success) {
        setTestResult({ id, ...data.data });
        if (data.data?.contextWindows) {
          const cw = data.data.contextWindows;
          setProviders((prev) =>
            prev.map((p) => p.id !== id ? p : { ...p, models: p.models.map((m) => { const ctx = cw[m.modelId]; return ctx ? { ...m, contextWindow: ctx } : m; }) }),
          );
        }
        if (data.data?.embeddingDims) {
          const dims: Record<string, number> = data.data.embeddingDims;
          setProviders((prev) =>
            prev.map((p) => p.id !== id ? p : { ...p, models: p.models.map((m) => { const dim = dims[m.modelId]; return dim !== undefined ? { ...m, embeddingDim: dim } : m; }) }),
          );
        }
        if (data.data?.embedDimErrors?.length) {
          setTestResult((prev) => prev ? { ...prev, embedDimErrors: data.data.embedDimErrors } : prev);
        }
      }
    } catch {
      setTestResult({ id, connected: false, error: t.common.messages.networkError });
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id: string) {
    try { await fetch(`/api/v1/models/providers/${id}`, { method: "DELETE" }); } catch {}
    setDeletingId(null);
    fetchProviders();
  }

  async function handleToggleDefault(modelConfigId: string, defaultFor: DefaultSlot, isCurrentlyDefault: boolean) {
    try {
      await fetch(`/api/v1/models/configs/${modelConfigId}/default`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setDefault: !isCurrentlyDefault, defaultFor }),
      });
    } catch {}
    fetchProviders();
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingProvider(null);
    fetchProviders();
  }

  const modelTabProps = {
    providers,
    loading,
    testingId,
    testResult,
    deletingId,
    onTest: handleTest,
    onEdit: (p: Provider) => { setEditingProvider(p); setShowForm(true); },
    onDelete: (id: string) => setDeletingId(id),
    onDeleteConfirm: handleDelete,
    onDeleteCancel: () => setDeletingId(null),
    onToggleDefault: handleToggleDefault,
    onAdd: () => { setEditingProvider(null); setShowForm(true); },
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex gap-2 border-b border-border mb-8 pb-px">
        {(["usage", "llm", "embedding", "rerank", "image"] as const).map((tabKey) => {
          const labels: Record<Tab, string> = { llm: t.models.tabs.llm, embedding: t.models.tabs.embedding, rerank: t.models.tabs.rerank, image: t.models.tabs.image, usage: t.models.tabs.usage };
          const isActive = tab === tabKey;
          return (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`px-5 py-2.5 text-sm font-medium transition-all -mb-px border-b-2 ${
                isActive
                  ? "text-primary border-primary font-semibold"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              {labels[tabKey]}
            </button>
          );
        })}
      </div>

      {(tab === "llm" || tab === "embedding" || tab === "rerank" || tab === "image") && (
        <ModelListTab slot={tab} {...modelTabProps} />
      )}

      {tab === "usage" && (
        <div className="animate-fade-in-up">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-foreground">{t.models.usage.title}</h3>
            <div className="flex bg-secondary p-1 rounded-xl">
              {(["today", "week", "month"] as const).map((range) => {
                const labels: Record<"today" | "week" | "month", string> = { today: t.models.usage.today, week: t.models.usage.sevenDays, month: t.models.usage.thirtyDays };
                const isActive = timeRange === range;
                return (
                  <button key={range} onClick={() => setTimeRange(range)}
                    className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${isActive ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground/75"}`}>
                    {labels[range]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-card border border-border rounded-2xl p-6 hover:shadow-hover transition-all shadow-soft group">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary/12 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                </div>
                <div className="text-sm font-semibold text-muted-foreground">{t.models.usage.totalTokens}</div>
              </div>
              <div className="text-3xl font-bold text-foreground">{usageData ? formatNumber(usageData.summary.totalInputTokens + usageData.summary.totalOutputTokens) : "0"}</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 hover:shadow-hover transition-all shadow-soft group">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-950/35 text-orange-600 dark:text-orange-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
                </div>
                <div className="text-sm font-semibold text-muted-foreground">{t.models.usage.totalCalls}</div>
              </div>
              <div className="text-3xl font-bold text-foreground">{usageData ? formatNumber(usageData.summary.totalCalls) : "0"}</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 hover:shadow-hover transition-all shadow-soft group">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-950/35 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" /></svg>
                </div>
                <div className="text-sm font-semibold text-muted-foreground">{t.models.usage.modelsUsed}</div>
              </div>
              <div className="text-3xl font-bold text-foreground">{usageData ? usageData.summary.modelsUsed : "0"}</div>
            </div>
          </div>

          {timeRange !== "today" && (
            <div className="bg-card border border-border rounded-2xl mb-6 shadow-soft">
              <div className="px-6 py-5 border-b border-border flex justify-between items-center">
                <h3 className="text-base font-semibold text-foreground">{t.models.usage.tokenUsageTrend} ({timeRange === "week" ? t.models.usage.sevenDays : t.models.usage.thirtyDays})</h3>
                <div className="flex gap-4 text-xs font-medium">
                  <span className="flex items-center gap-1.5 text-muted-foreground"><span className="w-3 h-3 rounded-sm bg-primary-500" /> {t.models.usage.input}</span>
                  <span className="flex items-center gap-1.5 text-muted-foreground"><span className="w-3 h-3 rounded-sm bg-primary-200" /> {t.models.usage.output}</span>
                </div>
              </div>
              <div className="p-6 pt-8">
                {!trendsData ? (
                  <div className="h-48 flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>
                ) : trendsData.total.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t.models.usage.noTrendData}</div>
                ) : (
                  <>
                    <div className="flex items-end gap-1.5 h-48 w-full">
                      {trendsData.total.map((day) => {
                        const maxTotal = Math.max(...trendsData.total.map((d) => d.input + d.output), 1);
                        const inputPct = (day.input / maxTotal) * 100;
                        const outputPct = (day.output / maxTotal) * 100;
                        return (
                          <div key={day.date} className="flex-1 flex flex-col justify-end min-w-[8px] h-full group relative">
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 text-white text-xs py-1.5 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap shadow-xl">
                              <div className="font-semibold mb-1">{day.date}</div>
                              <div>{t.models.usage.input}: {formatNumber(day.input)}</div>
                              <div>{t.models.usage.output}: {formatNumber(day.output)}</div>
                            </div>
                            <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: `${Math.max(inputPct + outputPct, 1)}%` }}>
                              {day.output > 0 && <div className="w-full bg-primary-200 rounded-t-sm transition-all" style={{ height: `${(day.output / (day.input + day.output)) * 100}%` }} />}
                              {day.input > 0 && <div className={`w-full bg-primary-500 transition-all ${day.output === 0 ? 'rounded-t-sm' : ''} rounded-b-sm`} style={{ height: `${(day.input / (day.input + day.output)) * 100}%` }} />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-3 font-medium">
                      <span>{trendsData.total[0]?.date}</span>
                      <span>{trendsData.total[trendsData.total.length - 1]?.date}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-2xl mb-6 shadow-soft">
            <div className="p-5 border-b border-border"><h3 className="text-base font-semibold text-foreground">{t.models.usage.modelTokenRanking}</h3></div>
            <div className="p-6">
              {usageData && usageData.byModel.length > 0 ? (
                <div className="space-y-5">
                  {usageData.byModel.map((m, idx) => {
                    const total = m.totalInputTokens + m.totalOutputTokens;
                    const maxTotal = usageData.byModel[0].totalInputTokens + usageData.byModel[0].totalOutputTokens;
                    const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                    const allTotal = usageData.summary.totalInputTokens + usageData.summary.totalOutputTokens;
                    const sharePct = allTotal > 0 ? ((total / allTotal) * 100).toFixed(1) : "0.0";
                    const rankBadge = idx === 0 ? "bg-yellow-100 text-yellow-700 border border-yellow-200 dark:bg-yellow-950/35 dark:text-yellow-300 dark:border-yellow-800/40" : idx === 1 ? "bg-secondary/80 text-foreground/75 border border-border" : idx === 2 ? "bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-950/35 dark:text-orange-300 dark:border-orange-800/40" : "bg-muted/50 text-muted-foreground border border-border";
                    const rankLabel = `#${idx + 1}`;
                    return (
                      <div key={m.modelConfigId}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-md ${rankBadge}`}>{rankLabel}</span>
                            <span className="text-sm font-semibold text-foreground">{m.modelName}</span>
                            <span className="text-xs px-2 py-0.5 bg-muted/50 rounded text-muted-foreground">{m.providerName}</span>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <span className="font-bold text-foreground/75">{formatNumber(total)}</span>
                            <span className="text-muted-foreground text-xs w-10 text-right">{sharePct}%</span>
                          </div>
                        </div>
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-sm text-center py-6 text-muted-foreground">{t.models.usage.noUsageData}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-card border border-border rounded-2xl shadow-soft">
              <div className="p-5 border-b border-border"><h3 className="text-base font-semibold text-foreground">{t.models.usage.usageByModule}</h3></div>
              {usageData && usageData.byModule.length > 0 ? (
                <div className="p-0 overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">{t.models.usage.module}</th>
                        <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">{t.models.usage.input}</th>
                        <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">{t.models.usage.output}</th>
                        <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">{t.models.usage.total}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageData.byModule.map((r) => (
                        <tr key={r.module} className="border-b border-border last:border-0 hover:bg-secondary/70 transition-colors">
                          <td className="px-5 py-3.5 text-sm font-medium text-foreground/75">{t.models.usage.modules[r.module] ?? r.module}</td>
                          <td className="px-5 py-3.5 text-sm text-right text-muted-foreground">{formatNumber(r.totalInputTokens)}</td>
                          <td className="px-5 py-3.5 text-sm text-right text-muted-foreground">{formatNumber(r.totalOutputTokens)}</td>
                          <td className="px-5 py-3.5 text-sm text-right font-semibold text-foreground">{formatNumber(r.totalInputTokens + r.totalOutputTokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="p-6"><p className="text-sm text-center py-4 text-muted-foreground">{t.models.usage.noModuleData}</p></div>}
            </div>
            <div className="bg-card border border-border rounded-2xl shadow-soft">
              <div className="p-5 border-b border-border"><h3 className="text-base font-semibold text-foreground">{t.models.usage.recentActivity}</h3></div>
              {usageData && usageData.entries.length > 0 ? (
                <div className="p-0 overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">{t.models.usage.model}</th>
                        <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">{t.models.usage.module}</th>
                        <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">{t.models.usage.tokens}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageData.entries.slice(0, 5).map((e) => (
                        <tr key={e.id} className="border-b border-border last:border-0 hover:bg-secondary/70 transition-colors">
                          <td className="px-5 py-3.5 text-sm font-medium text-foreground/75"><div className="truncate max-w-[120px]">{e.modelName ?? t.models.usage.unknown}</div></td>
                          <td className="px-5 py-3.5 text-sm text-muted-foreground"><span className="px-2 py-0.5 bg-secondary rounded text-xs">{t.models.usage.modules[e.module] ?? e.module}</span></td>
                          <td className="px-5 py-3.5 text-sm text-right font-medium text-foreground/75">{formatNumber(e.inputTokens + e.outputTokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="p-6"><p className="text-sm text-center py-4 text-muted-foreground">{t.models.usage.noRecentActivity}</p></div>}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => handleFormClose()}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
            <ProviderForm provider={editingProvider} tab={tab === "usage" ? "llm" : (tab as "llm" | "embedding" | "rerank" | "image")} onClose={handleFormClose} />
          </div>
        </div>
      )}
    </div>
  );
}
