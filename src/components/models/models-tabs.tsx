"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ProviderForm } from "./provider-form";
import type { Provider, UsageData } from "./types";

type Tab = "llm" | "embedding" | "usage";
type TimeRange = "today" | "week" | "month";

interface IconColors {
  bg: string;
  text: string;
}

const MODEL_ICON_COLORS: IconColors[] = [
  { bg: "bg-[#EFF6FF]", text: "text-[#2563EB]" },
  { bg: "bg-[#DCFCE7]", text: "text-[#16A34A]" },
  { bg: "bg-[#FEF3C7]", text: "text-[#D97706]" },
  { bg: "bg-[#FFF7ED]", text: "text-[#EA580C]" },
  { bg: "bg-primary-100", text: "text-primary" },
];

const TIME_RANGE_TO_DAYS: Record<TimeRange, number> = {
  today: 1,
  week: 7,
  month: 30,
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function parseContextWindow(n: number | null): string {
  if (n === null || n === 0) return "-";
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// --- Shared compact model card ---

function ModelCard({
  name,
  providerName,
  contextWindow,
  isActive,
  isTesting,
  testResult,
  isDeleting,
  iconColors,
  onTest,
  onEdit,
  onDelete,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  name: string;
  providerName: string;
  contextWindow: number;
  isActive: boolean;
  isTesting: boolean;
  testResult: { connected: boolean; contextWindows?: Record<string, number>; error?: string } | null;
  isDeleting: boolean;
  iconColors: IconColors;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  return (
    <div
      className={`bg-base-white border rounded-[16px] px-6 py-5 hover:shadow-md transition-all relative overflow-hidden ${isTesting ? "border-primary/30" : "border-[#E4E4E7]"}`}
      style={{ animation: "fadeInUp 0.4s ease both" }}
    >
      {isTesting && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#E4E4E7] overflow-hidden">
          <div className="h-full bg-primary animate-loading-bar" style={{ width: "40%" }} />
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 ${iconColors.bg} ${iconColors.text}`}>
            <svg className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div className="text-[16px] font-semibold text-foreground">{name}</div>
            <div className="text-[13px] text-muted-foreground mt-0.5">
              {providerName}{contextWindow > 0 && (<><span className="text-[#E4E4E7] mx-1">·</span>{parseContextWindow(contextWindow)} tokens</>)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {testResult ? (
            <span className={`text-[12px] font-medium px-2.5 py-1 rounded-full ${testResult.connected ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-[#FEE2E2] text-[#DC2626]"}`}>
              {testResult.connected ? "Connected" : "Failed"}
            </span>
          ) : isActive ? (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#16A34A]">
              <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#EA580C]">
              <span className="w-2 h-2 rounded-full bg-[#EA580C]" />
              Disconnected
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[#F0F0F0] pt-3">
        <span className="text-[13px] text-muted-foreground">{providerName}</span>
        <div className="flex items-center gap-2">
          {isDeleting ? (
            <>
              <button onClick={onDeleteConfirm}
                className="px-4 py-2 text-[13px] font-medium bg-[#DC2626] text-white rounded-xl hover:bg-red-700 transition-colors">
                Confirm
              </button>
              <button onClick={onDeleteCancel}
                className="px-4 py-2 text-[13px] font-medium border border-[#E4E4E7] rounded-xl hover:bg-[#F4F4F5] transition-colors">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={onTest} disabled={isTesting}
                className="px-4 py-2 text-[13px] font-medium border border-[#E4E4E7] rounded-xl hover:bg-[#F4F4F5] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
                {isTesting ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Testing...
                  </>
                ) : "Test"}
              </button>
              <button onClick={onEdit}
                className="px-4 py-2 text-[13px] font-medium text-muted-foreground rounded-xl hover:bg-[#F4F4F5] transition-colors">
                Edit
              </button>
              <button onClick={onDelete}
                className="px-4 py-2 text-[13px] font-medium text-[#DC2626] rounded-xl hover:bg-[#FEE2E2] transition-colors">
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

export function ModelsTabs() {
  const [tab, setTab] = useState<Tab>("llm");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; connected: boolean; contextWindows?: Record<string, number>; error?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [timeRange, setTimeRange] = useState<TimeRange>("month");
  const [usageData, setUsageData] = useState<UsageData | null>(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/models/providers");
      const data = await res.json();
      if (data.success) setProviders(data.data);
    } catch {
      // Failed to fetch providers
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsage = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/v1/models/usage?days=${days}`);
      const data = await res.json();
      if (data.success) {
        setUsageData(data.data);
      }
    } catch {
      // Failed to fetch usage
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const usageDays = TIME_RANGE_TO_DAYS[timeRange];

  useEffect(() => {
    if (tab === "usage") fetchUsage(usageDays);
  }, [tab, usageDays, fetchUsage]);

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
        // Update provider state with auto-detected context windows
        if (data.data?.contextWindows) {
          const cw = data.data.contextWindows;
          setProviders((prev) =>
            prev.map((p) => {
              if (p.id !== id) return p;
              return {
                ...p,
                models: p.models.map((m) => {
                  const ctx = cw[m.modelId];
                  return ctx ? { ...m, contextWindow: ctx } : m;
                }),
              };
            }),
          );
        }
      }
    } catch {
      setTestResult({ id, connected: false, error: "Network error" });
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/v1/models/providers/${id}`, { method: "DELETE" });
    } catch {
      // Delete request failed
    }
    setDeletingId(null);
    fetchProviders();
  }

  function handleEdit(provider: Provider) {
    setEditingProvider(provider);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingProvider(null);
    fetchProviders();
  }

  function isEmbeddingModel(m: Provider["models"][number]): boolean {
    try {
      const caps = JSON.parse(m.capabilities ?? "[]");
      return Array.isArray(caps) && caps.some((c: string) => c === "embedding" || c === "embed");
    } catch {
      return false;
    }
  }

  // Flatten providers → model cards (LLM only, exclude embedding)
  const llmModels = useMemo(() => {
    const result: Array<{ provider: Provider; modelIndex: number; iconColors: IconColors }> = [];
    providers.forEach((p) => {
      p.models.forEach((m, idx) => {
        if (isEmbeddingModel(m)) return;
        const colorIdx = result.length % MODEL_ICON_COLORS.length;
        result.push({ provider: p, modelIndex: idx, iconColors: MODEL_ICON_COLORS[colorIdx] });
      });
    });
    return result;
  }, [providers]);

  const embeddingModels = useMemo(() => {
    const result: Array<{ provider: Provider; modelIndex: number; iconColors: IconColors }> = [];
    providers.forEach((p) => {
      p.models.forEach((m, idx) => {
        if (!isEmbeddingModel(m)) return;
        const colorIdx = result.length % MODEL_ICON_COLORS.length;
        result.push({ provider: p, modelIndex: idx, iconColors: MODEL_ICON_COLORS[colorIdx] });
      });
    });
    return result;
  }, [providers]);

  const renderAddCard = (title: string, subtitle: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="w-full border border-dashed border-[#E4E4E7] rounded-[16px] px-6 py-5 flex items-center gap-3 hover:border-primary/40 hover:bg-primary-50 transition-all cursor-pointer group"
      style={{ animation: "fadeInUp 0.4s ease both 0.2s" }}
    >
      <div className="w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 bg-[#F4F4F5] text-muted-foreground group-hover:bg-primary-100 group-hover:text-primary transition-colors">
        <svg className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
      <div className="text-left">
        <div className="text-[16px] font-semibold text-foreground group-hover:text-primary transition-colors">{title}</div>
        <div className="text-[13px] text-muted-foreground">{subtitle}</div>
      </div>
    </button>
  );

  return (
    <div>
      {/* Tab headers */}
      <div className="flex gap-0 border-b border-border mb-6">
        {(["llm", "embedding", "usage"] as const).map((t) => {
          const labels: Record<Tab, string> = { llm: "LLM Models", embedding: "Embedding Models", usage: "Token Usage" };
          const isActive = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium transition-colors -mb-px border-b-2 bg-transparent border-t-0 border-l-0 border-r-0 font-sans ${
                isActive
                  ? "text-primary border-b-primary font-semibold"
                  : "text-muted-foreground border-b-transparent hover:text-foreground"
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Tab: LLM Models */}
      {tab === "llm" && (
        <div>
          <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
            Configure LLM models for writing, chat, brainstorming, and other generation tasks.
          </p>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-3">
              {llmModels.map(({ provider, modelIndex, iconColors }) => {
                const model = provider.models[modelIndex];
                return (
                  <ModelCard
                    key={`${provider.id}-${model.id}`}
                    name={model.modelName}
                    providerName={provider.name}
                    contextWindow={model.contextWindow}
                    isActive={provider.isActive}
                    isTesting={testingId === provider.id}
                    testResult={testResult?.id === provider.id ? testResult : null}
                    isDeleting={deletingId === provider.id}
                    iconColors={iconColors}
                    onTest={() => handleTest(provider.id)}
                    onEdit={() => handleEdit(provider)}
                    onDelete={() => setDeletingId(provider.id)}
                    onDeleteConfirm={() => handleDelete(provider.id)}
                    onDeleteCancel={() => setDeletingId(null)}
                  />
                );
              })}
              {llmModels.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed border-[#E4E4E7] rounded-[16px]">
                  No LLM models configured. Click "Add LLM Model" to connect a provider.
                </div>
              )}
              {renderAddCard(
                "Add LLM Model",
                "Ollama, OpenAI, Anthropic, or custom endpoint",
                () => { setEditingProvider(null); setShowForm(true); },
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: Embedding Models */}
      {tab === "embedding" && (
        <div>
          <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
            Configure embedding models for document indexing and semantic search retrieval. Switching embedding models requires re-indexing all documents.
          </p>
          <div className="space-y-3">
            {embeddingModels.map(({ provider, modelIndex, iconColors }) => {
              const model = provider.models[modelIndex];
              return (
                <ModelCard
                  key={`${provider.id}-${model.id}`}
                  name={model.modelName}
                  providerName={provider.name}
                  contextWindow={model.contextWindow}
                  isActive={provider.isActive}
                  isTesting={testingId === provider.id}
                  testResult={testResult?.id === provider.id ? testResult : null}
                  isDeleting={deletingId === provider.id}
                  iconColors={iconColors}
                  onTest={() => handleTest(provider.id)}
                  onEdit={() => handleEdit(provider)}
                  onDelete={() => setDeletingId(provider.id)}
                  onDeleteConfirm={() => handleDelete(provider.id)}
                  onDeleteCancel={() => setDeletingId(null)}
                />
              );
            })}
            {embeddingModels.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed border-[#E4E4E7] rounded-[16px]">
                No embedding models configured. Add a provider with embedding capability.
              </div>
            )}
            {renderAddCard(
              "Add Embedding Model",
              "Connect an embedding service for document indexing",
              () => { setEditingProvider(null); setShowForm(true); },
            )}
          </div>
        </div>
      )}

      {/* Tab: Token Usage */}
      {tab === "usage" && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-base font-bold font-[var(--font-display,Urbanist),sans-serif]">Token Usage Overview</h3>
            <div className="flex">
              {(["today", "week", "month"] as const).map((range, idx) => {
                const labels: Record<"today" | "week" | "month", string> = { today: "Today", week: "This Week", month: "This Month" };
                const isActive = timeRange === range;
                const radiusClass = idx === 0 ? "rounded-l-xl" : idx === 2 ? "rounded-r-xl" : "";
                return (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-4 py-2 text-[13px] font-medium border transition-colors ${radiusClass} ${
                      isActive
                        ? "bg-primary text-white border-primary"
                        : "bg-white border-border text-muted-foreground hover:bg-base-gray"
                    }`}
                  >
                    {labels[range]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
            <div className="bg-white border border-border rounded-2xl p-6 flex items-start gap-4 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-primary-100 text-primary flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] text-muted-foreground mb-1">Total Tokens</div>
                <div className="text-[28px] font-bold leading-tight font-[var(--font-display,Urbanist),sans-serif]">
                  {usageData ? formatNumber(usageData.summary.totalInputTokens + usageData.summary.totalOutputTokens) : "0"}
                </div>
              </div>
            </div>

            <div className="bg-white border border-border rounded-2xl p-6 flex items-start gap-4 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#FFF7ED] text-[#EA580C] flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] text-muted-foreground mb-1">Total Calls</div>
                <div className="text-[28px] font-bold leading-tight font-[var(--font-display,Urbanist),sans-serif]">
                  {usageData ? formatNumber(usageData.summary.totalCalls) : "0"}
                </div>
              </div>
            </div>

            <div className="bg-white border border-border rounded-2xl p-6 flex items-start gap-4 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] text-muted-foreground mb-1">Models Used</div>
                <div className="text-[28px] font-bold leading-tight font-[var(--font-display,Urbanist),sans-serif]">
                  {usageData ? usageData.summary.modelsUsed : "0"}
                </div>
              </div>
            </div>
          </div>

          {/* Model Token Ranking */}
          <div className="bg-white border border-border rounded-2xl mb-5 hover:shadow-md transition-all">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-base font-semibold">Model Token Ranking</h3>
            </div>
            <div className="p-6">
              {usageData && usageData.byModel.length > 0 ? (
                <div className="space-y-4">
                  {usageData.byModel.map((m, idx) => {
                    const total = m.totalInputTokens + m.totalOutputTokens;
                    const maxTotal = usageData.byModel[0].totalInputTokens + usageData.byModel[0].totalOutputTokens;
                    const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                    const allTotal = usageData.summary.totalInputTokens + usageData.summary.totalOutputTokens;
                    const sharePct = allTotal > 0 ? ((total / allTotal) * 100).toFixed(1) : "0.0";
                    const rankBadge = idx === 0
                      ? "bg-[#FEF3C7] text-[#D97706]"
                      : idx === 1
                        ? "bg-[#F5F5F4] text-[#78716C]"
                        : idx === 2
                          ? "bg-[#FFF7ED] text-[#EA580C]"
                          : "bg-base-gray text-muted-foreground";
                    const rankLabel = idx < 3
                      ? ["1st", "2nd", "3rd"][idx]
                      : `#${idx + 1}`;
                    return (
                      <div key={m.modelConfigId}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${rankBadge}`}>{rankLabel}</span>
                            <span className="text-sm font-medium text-foreground">{m.modelName}</span>
                            <span className="text-[12px] text-muted-foreground">{m.providerName}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[13px]">
                            <span className="font-medium text-foreground">{formatNumber(total)}</span>
                            <span className="text-muted-foreground">({sharePct}%)</span>
                          </div>
                        </div>
                        <div className="w-full h-2.5 bg-base-gray rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">No usage data yet. Start using models to see ranking.</p>
              )}
            </div>
          </div>

          {/* Usage by Module */}
          <div className="bg-white border border-border rounded-2xl mb-5 hover:shadow-md transition-all">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-base font-semibold">Usage by Module</h3>
            </div>
            {usageData && usageData.byModule.length > 0 ? (
              <div className="p-0">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-base-gray border-b border-border">
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Module</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Input</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Output</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Total</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.byModule.map((r) => {
                      const MODULE_LABELS: Record<string, string> = {
                        brainstorm: "头脑风暴",
                        outline: "大纲生成",
                        writing: "文档写作",
                        embedding: "文档索引",
                        comparison: "模型对比",
                      };
                      return (
                        <tr key={r.module} className="border-b border-border/40 last:border-0 hover:bg-primary-50 transition-colors">
                          <td className="px-4 py-3.5 text-sm font-medium">{MODULE_LABELS[r.module] ?? r.module}</td>
                          <td className="px-4 py-3.5 text-sm text-right">{formatNumber(r.totalInputTokens)}</td>
                          <td className="px-4 py-3.5 text-sm text-right">{formatNumber(r.totalOutputTokens)}</td>
                          <td className="px-4 py-3.5 text-sm text-right font-medium">{formatNumber(r.totalInputTokens + r.totalOutputTokens)}</td>
                          <td className="px-4 py-3.5 text-sm text-right">{formatNumber(r.totalCalls)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6">
                <p className="text-sm text-muted-foreground text-center py-4">No module data yet.</p>
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="bg-white border border-border rounded-2xl mb-5 hover:shadow-md transition-all">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-base font-semibold">Recent Activity</h3>
            </div>
            {usageData && usageData.entries.length > 0 ? (
              <div className="p-0">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-base-gray border-b border-border">
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Model</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Module</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Input</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Output</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.entries.map((e) => {
                      const MODULE_LABELS: Record<string, string> = {
                        brainstorm: "头脑风暴",
                        outline: "大纲生成",
                        writing: "文档写作",
                        embedding: "文档索引",
                        comparison: "模型对比",
                      };
                      return (
                        <tr key={e.id} className="border-b border-border/40 last:border-0 hover:bg-primary-50 transition-colors">
                          <td className="px-4 py-3.5 text-sm font-medium">
                            {e.modelName ?? "Unknown"}
                            {e.providerName && <span className="text-muted-foreground ml-1">({e.providerName})</span>}
                          </td>
                          <td className="px-4 py-3.5 text-sm">{MODULE_LABELS[e.module] ?? e.module}</td>
                          <td className="px-4 py-3.5 text-sm text-right">{formatNumber(e.inputTokens)}</td>
                          <td className="px-4 py-3.5 text-sm text-right">{formatNumber(e.outputTokens)}</td>
                          <td className="px-4 py-3.5 text-sm text-right text-muted-foreground">
                            {new Date(e.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6">
                <p className="text-sm text-muted-foreground text-center py-4">No recent activity.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Provider form dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => handleFormClose()}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <ProviderForm provider={editingProvider} onClose={handleFormClose} />
          </div>
        </div>
      )}
    </div>
  );
}
