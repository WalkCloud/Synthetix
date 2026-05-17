"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ProviderForm } from "./provider-form";
import { parseCapabilities } from "@/lib/llm/capabilities";
import type { Provider, UsageData } from "./types";

type Tab = "llm" | "embedding" | "image" | "usage";
type TimeRange = "today" | "week" | "month";

interface IconColors {
  bg: string;
  text: string;
}

const MODEL_ICON_COLORS: IconColors[] = [
  { bg: "bg-blue-50", text: "text-blue-600" },
  { bg: "bg-green-50", text: "text-green-600" },
  { bg: "bg-yellow-50", text: "text-yellow-600" },
  { bg: "bg-orange-50", text: "text-orange-600" },
  { bg: "bg-primary-50", text: "text-primary-600" },
];

const MODULE_LABELS: Record<string, string> = {
  brainstorm: "Brainstorm",
  outline: "Outline Gen",
  writing: "Writing",
  embedding: "Indexing",
  comparison: "Comparison",
};

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
      className={`bg-white border rounded-2xl px-6 py-5 shadow-soft hover:shadow-hover transition-all relative overflow-hidden ${isTesting ? "border-primary-300" : "border-border"}`}
      style={{ animation: "fadeInUp 0.4s ease both" }}
    >
      {isTesting && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-slate-100 overflow-hidden">
          <div className="h-full bg-primary-600 animate-loading-bar" style={{ width: "40%" }} />
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconColors.bg} ${iconColors.text}`}>
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div className="text-base font-semibold text-foreground">{name}</div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {providerName}{contextWindow > 0 && (<><span className="text-slate-300 mx-1.5">|</span>{parseContextWindow(contextWindow)} tokens</>)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {testResult ? (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${testResult.connected ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
              {testResult.connected ? "Connected" : "Failed"}
            </span>
          ) : isActive ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              Disconnected
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-4">
        <span className="text-xs font-medium px-2 py-1 bg-slate-50 text-slate-500 rounded-md border border-slate-100">{providerName}</span>
        <div className="flex items-center gap-2">
          {isDeleting ? (
            <>
              <button onClick={onDeleteConfirm}
                className="px-4 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm">
                Confirm
              </button>
              <button onClick={onDeleteCancel}
                className="px-4 py-1.5 text-sm font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={onTest} disabled={isTesting}
                className="px-4 py-1.5 text-sm font-medium border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 hover:text-primary-600 hover:border-primary-200 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm">
                {isTesting ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Testing...
                  </>
                ) : "Test Connection"}
              </button>
              <button onClick={onEdit}
                className="px-4 py-1.5 text-sm font-medium text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                Edit
              </button>
              <button onClick={onDelete}
                className="px-4 py-1.5 text-sm font-medium text-red-600 rounded-lg hover:bg-red-50 transition-colors">
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
  const [trendsData, setTrendsData] = useState<{ total: Array<{ date: string; input: number; output: number }>; byModule: Record<string, Array<{ date: string; input: number; output: number }>>; summary: { totalInput: number; totalOutput: number; totalCalls: number; days: number } } | null>(null);

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

  const fetchTrends = useCallback(async (days: number) => {
    try {
      // The API takes days=X and returns trend data for the last X days.
      const res = await fetch(`/api/v1/models/usage/trends?days=${days}`);
      const data = await res.json();
      if (data.success) setTrendsData(data.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

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
        if (data.data?.embeddingDims) {
          const dims: Record<string, number> = data.data.embeddingDims;
          setProviders((prev) =>
            prev.map((p) => {
              if (p.id !== id) return p;
              return {
                ...p,
                models: p.models.map((m) => {
                  const dim = dims[m.modelId];
                  return dim !== undefined ? { ...m, embeddingDim: dim } : m;
                }),
              };
            }),
          );
        }
        if (data.data?.embedDimErrors?.length) {
          setTestResult((prev) => prev ? { ...prev, embedDimErrors: data.data.embedDimErrors } : prev);
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
    const caps = parseCapabilities(m.capabilities);
    return caps.some((c) => c === "embedding" || c === "embed");
  }

  function isImageModel(m: Provider["models"][number]): boolean {
    const caps = parseCapabilities(m.capabilities);
    return caps.includes("image_generation");
  }

  const llmModels = useMemo(() => {
    const result: Array<{ provider: Provider; modelIndex: number; iconColors: IconColors }> = [];
    providers.forEach((p) => {
      p.models.forEach((m, idx) => {
        if (isEmbeddingModel(m)) return;
        if (isImageModel(m)) return;
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

  const imageModels = useMemo(() => {
    const result: Array<{ provider: Provider; modelIndex: number; iconColors: IconColors }> = [];
    providers.forEach((p) => {
      p.models.forEach((m, idx) => {
        if (!isImageModel(m)) return;
        const colorIdx = result.length % MODEL_ICON_COLORS.length;
        result.push({ provider: p, modelIndex: idx, iconColors: MODEL_ICON_COLORS[colorIdx] });
      });
    });
    return result;
  }, [providers]);

  const renderAddCard = (title: string, subtitle: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-2xl px-6 py-5 flex items-center gap-4 hover:border-primary-400 hover:bg-primary-50 transition-all cursor-pointer group shadow-soft"
      style={{ animation: "fadeInUp 0.4s ease both 0.2s" }}
    >
      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-white shadow-sm text-slate-400 group-hover:text-primary-600 transition-colors">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
      <div className="text-left">
        <div className="text-base font-semibold text-slate-700 group-hover:text-primary-700 transition-colors">{title}</div>
        <div className="text-sm text-slate-500">{subtitle}</div>
      </div>
    </button>
  );

  return (
    <div className="max-w-5xl mx-auto">
      {/* Tab headers */}
      <div className="flex gap-2 border-b border-border mb-8 pb-px">
        {(["llm", "embedding", "image", "usage"] as const).map((t) => {
          const labels: Record<Tab, string> = { llm: "LLM Models", embedding: "Embedding Models", image: "Image Generation", usage: "Usage Analytics" };
          const isActive = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-semibold transition-all rounded-t-xl -mb-[2px] border-b-2 ${
                isActive
                  ? "text-primary-600 border-b-primary-600 bg-primary-50/50"
                  : "text-slate-500 border-b-transparent hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Tab: LLM Models */}
      {tab === "llm" && (
        <div className="animate-fade-in-up">
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Configure LLM models for writing, chat, brainstorming, and other generation tasks.
          </p>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-4">
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
                <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50">
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
        <div className="animate-fade-in-up">
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Configure embedding models for document indexing and semantic search retrieval. Switching embedding models requires re-indexing all documents.
          </p>
          <div className="space-y-4">
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
              <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50">
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

      {/* Tab: Image Generation Models */}
      {tab === "image" && (
        <div className="animate-fade-in-up">
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Configure text-to-image models for the Gen feature in the writing panel. These models generate illustrations from text prompts via OpenAI-compatible image APIs.
          </p>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-4">
              {imageModels.map(({ provider, modelIndex, iconColors }) => {
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
              {imageModels.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50">
                  No image generation models configured. Add a provider with an image generation model (e.g. DALL-E, Flux, Wanx).
                </div>
              )}
              {renderAddCard(
                "Add Image Model",
                "DALL-E, Flux, Wanx, or other OpenAI-compatible image endpoint",
                () => { setEditingProvider(null); setShowForm(true); },
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: Usage Analytics (Merged) */}
      {tab === "usage" && (
        <div className="animate-fade-in-up">
          {/* Header & Global Time Range Toggle */}
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-slate-800">Usage Analytics</h3>
            <div className="flex bg-slate-100 p-1 rounded-xl">
              {(["today", "week", "month"] as const).map((range) => {
                const labels: Record<"today" | "week" | "month", string> = { today: "Today", week: "7 Days", month: "30 Days" };
                const isActive = timeRange === range;
                return (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${
                      isActive
                        ? "bg-white text-primary-600 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {labels[range]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1. Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-border rounded-2xl p-6 hover:shadow-hover transition-all shadow-soft group">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <div className="text-sm font-semibold text-slate-500">Total Tokens</div>
              </div>
              <div className="text-3xl font-bold text-slate-800">
                {usageData ? formatNumber(usageData.summary.totalInputTokens + usageData.summary.totalOutputTokens) : "0"}
              </div>
            </div>

            <div className="bg-white border border-border rounded-2xl p-6 hover:shadow-hover transition-all shadow-soft group">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
                  </svg>
                </div>
                <div className="text-sm font-semibold text-slate-500">Total Calls</div>
              </div>
              <div className="text-3xl font-bold text-slate-800">
                {usageData ? formatNumber(usageData.summary.totalCalls) : "0"}
              </div>
            </div>

            <div className="bg-white border border-border rounded-2xl p-6 hover:shadow-hover transition-all shadow-soft group">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" />
                  </svg>
                </div>
                <div className="text-sm font-semibold text-slate-500">Models Used</div>
              </div>
              <div className="text-3xl font-bold text-slate-800">
                {usageData ? usageData.summary.modelsUsed : "0"}
              </div>
            </div>
          </div>

          {/* 2. Usage Trends Visualization (Bar Chart) */}
          {timeRange !== "today" && (
            <div className="bg-white border border-border rounded-2xl mb-6 shadow-soft">
              <div className="px-6 py-5 border-b border-border flex justify-between items-center">
                <h3 className="text-base font-semibold text-slate-800">Token Usage Trend ({timeRange === "week" ? "7 Days" : "30 Days"})</h3>
                <div className="flex gap-4 text-xs font-medium">
                  <span className="flex items-center gap-1.5 text-slate-600"><span className="w-3 h-3 rounded-sm bg-primary-500" /> Input</span>
                  <span className="flex items-center gap-1.5 text-slate-600"><span className="w-3 h-3 rounded-sm bg-primary-200" /> Output</span>
                </div>
              </div>
              <div className="p-6 pt-8">
                {!trendsData ? (
                  <div className="h-48 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : trendsData.total.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No trend data available for this period.</div>
                ) : (
                  <>
                    <div className="flex items-end gap-1.5 h-48 w-full">
                      {trendsData.total.map((day) => {
                        const maxTotal = Math.max(...trendsData.total.map((d) => d.input + d.output), 1);
                        const inputPct = (day.input / maxTotal) * 100;
                        const outputPct = (day.output / maxTotal) * 100;
                        return (
                          <div key={day.date} className="flex-1 flex flex-col justify-end min-w-[8px] h-full group relative">
                            {/* Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 text-white text-xs py-1.5 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap shadow-xl">
                              <div className="font-semibold mb-1">{day.date}</div>
                              <div>In: {formatNumber(day.input)}</div>
                              <div>Out: {formatNumber(day.output)}</div>
                            </div>
                            
                            <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: `${Math.max(inputPct + outputPct, 1)}%` }}>
                              {day.output > 0 && <div className="w-full bg-primary-200 rounded-t-sm transition-all" style={{ height: `${(day.output / (day.input + day.output)) * 100}%` }} />}
                              {day.input > 0 && <div className={`w-full bg-primary-500 transition-all ${day.output === 0 ? 'rounded-t-sm' : ''} rounded-b-sm`} style={{ height: `${(day.input / (day.input + day.output)) * 100}%` }} />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-xs text-slate-400 mt-3 font-medium">
                      <span>{trendsData.total[0]?.date}</span>
                      <span>{trendsData.total[trendsData.total.length - 1]?.date}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 3. Model Token Ranking */}
          <div className="bg-white border border-border rounded-2xl mb-6 shadow-soft">
            <div className="p-5 border-b border-border">
              <h3 className="text-base font-semibold text-slate-800">Model Token Ranking</h3>
            </div>
            <div className="p-6">
              {usageData && usageData.byModel.length > 0 ? (
                <div className="space-y-5">
                  {usageData.byModel.map((m, idx) => {
                    const total = m.totalInputTokens + m.totalOutputTokens;
                    const maxTotal = usageData.byModel[0].totalInputTokens + usageData.byModel[0].totalOutputTokens;
                    const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                    const allTotal = usageData.summary.totalInputTokens + usageData.summary.totalOutputTokens;
                    const sharePct = allTotal > 0 ? ((total / allTotal) * 100).toFixed(1) : "0.0";
                    const rankBadge = idx === 0
                      ? "bg-yellow-100 text-yellow-700 border border-yellow-200"
                      : idx === 1
                        ? "bg-slate-200 text-slate-700 border border-slate-300"
                        : idx === 2
                          ? "bg-orange-100 text-orange-700 border border-orange-200"
                          : "bg-slate-50 text-slate-500 border border-slate-100";
                    const rankLabel = idx < 3
                      ? ["1st", "2nd", "3rd"][idx]
                      : `#${idx + 1}`;
                    return (
                      <div key={m.modelConfigId}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-md ${rankBadge}`}>{rankLabel}</span>
                            <span className="text-sm font-semibold text-slate-800">{m.modelName}</span>
                            <span className="text-xs px-2 py-0.5 bg-slate-50 rounded text-slate-500">{m.providerName}</span>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <span className="font-bold text-slate-700">{formatNumber(total)}</span>
                            <span className="text-slate-400 text-xs w-10 text-right">{sharePct}%</span>
                          </div>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-center py-6 text-slate-500">No usage data for this period.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* 4. Usage by Module */}
            <div className="bg-white border border-border rounded-2xl shadow-soft">
              <div className="p-5 border-b border-border">
                <h3 className="text-base font-semibold text-slate-800">Usage by Module</h3>
              </div>
              {usageData && usageData.byModule.length > 0 ? (
                <div className="p-0 overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left text-xs font-semibold text-slate-500 px-5 py-3">Module</th>
                        <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">Input</th>
                        <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">Output</th>
                        <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageData.byModule.map((r) => {
                        return (
                          <tr key={r.module} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                            <td className="px-5 py-3.5 text-sm font-medium text-slate-700">{MODULE_LABELS[r.module] ?? r.module}</td>
                            <td className="px-5 py-3.5 text-sm text-right text-slate-600">{formatNumber(r.totalInputTokens)}</td>
                            <td className="px-5 py-3.5 text-sm text-right text-slate-600">{formatNumber(r.totalOutputTokens)}</td>
                            <td className="px-5 py-3.5 text-sm text-right font-semibold text-slate-800">{formatNumber(r.totalInputTokens + r.totalOutputTokens)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6">
                  <p className="text-sm text-center py-4 text-slate-500">No module data.</p>
                </div>
              )}
            </div>

            {/* 5. Recent Activity */}
            <div className="bg-white border border-border rounded-2xl shadow-soft">
              <div className="p-5 border-b border-border">
                <h3 className="text-base font-semibold text-slate-800">Recent Activity</h3>
              </div>
              {usageData && usageData.entries.length > 0 ? (
                <div className="p-0 overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left text-xs font-semibold text-slate-500 px-5 py-3">Model</th>
                        <th className="text-left text-xs font-semibold text-slate-500 px-5 py-3">Module</th>
                        <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageData.entries.slice(0, 5).map((e) => {
                        return (
                          <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                            <td className="px-5 py-3.5 text-sm font-medium text-slate-700">
                              <div className="truncate max-w-[120px]">{e.modelName ?? "Unknown"}</div>
                            </td>
                            <td className="px-5 py-3.5 text-sm text-slate-600">
                              <span className="px-2 py-0.5 bg-slate-100 rounded text-xs">{MODULE_LABELS[e.module] ?? e.module}</span>
                            </td>
                            <td className="px-5 py-3.5 text-sm text-right font-medium text-slate-700">
                              {formatNumber(e.inputTokens + e.outputTokens)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6">
                  <p className="text-sm text-center py-4 text-slate-500">No recent activity.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Provider form dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => handleFormClose()}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <ProviderForm provider={editingProvider} tab={tab === "usage" ? "llm" : (tab as "llm" | "embedding" | "image")} onClose={handleFormClose} />
          </div>
        </div>
      )}
    </div>
  );
}
