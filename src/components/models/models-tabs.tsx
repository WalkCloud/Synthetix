"use client";

import { useState, useEffect, useCallback } from "react";
import { ProviderForm } from "./provider-form";
import type { Provider, UsageEntry, UsageSummary } from "./types";

type Tab = "providers" | "usage";

export function ModelsTabs() {
  const [tab, setTab] = useState<Tab>("providers");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; connected: boolean; models?: string[]; error?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Usage state
  const [usageDays, setUsageDays] = useState(30);
  const [usageEntries, setUsageEntries] = useState<UsageEntry[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/v1/models/providers");
    const data = await res.json();
    if (data.success) setProviders(data.data);
    setLoading(false);
  }, []);

  const fetchUsage = useCallback(async (days: number) => {
    const res = await fetch(`/api/v1/models/usage?days=${days}`);
    const data = await res.json();
    if (data.success) {
      setUsageEntries(data.data.usage);
      setUsageSummary(data.data.summary);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    if (tab === "usage") fetchUsage(usageDays);
  }, [tab, usageDays, fetchUsage]);

  async function handleTest(id: string) {
    setTestingId(id);
    setTestResult(null);
    const res = await fetch(`/api/v1/models/providers/${id}/test`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      setTestResult({ id, ...data.data });
    }
    setTestingId(null);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/v1/models/providers/${id}`, { method: "DELETE" });
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

  const providerTypeLabels: Record<string, string> = {
    ollama: "Ollama",
    openai_compatible: "OpenAI Compatible",
    anthropic: "Anthropic",
    custom: "Custom",
  };

  return (
    <div>
      {/* Tab headers */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab("providers")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "providers" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          提供商
        </button>
        <button
          onClick={() => setTab("usage")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "usage" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          用量统计
        </button>
      </div>

      {tab === "providers" && (
        <div>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">加载中...</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {providers.map((p) => (
                <div key={p.id} className="bg-white border rounded-2xl overflow-hidden hover:shadow-md transition-all">
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                          <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="font-semibold">{p.name}</h3>
                          <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{providerTypeLabels[p.providerType] || p.providerType}</span>
                        </div>
                      </div>
                      {!p.isActive && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">已禁用</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3 truncate">{p.apiBaseUrl}</p>

                    {p.models.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {p.models.map((m) => (
                          <span key={m.id} className="text-xs bg-primary/5 text-primary px-2.5 py-1 rounded-lg">
                            {m.modelName}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Test result */}
                    {testResult?.id === p.id && (
                      <div className={`mb-3 px-3 py-2 rounded-xl text-xs ${testResult.connected ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                        {testResult.connected
                          ? `连接成功${testResult.models?.length ? `，发现 ${testResult.models.length} 个模型` : ""}`
                          : `连接失败${testResult.error ? `: ${testResult.error}` : ""}`}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button onClick={() => handleTest(p.id)} disabled={testingId === p.id}
                        className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
                        {testingId === p.id ? "测试中..." : "测试连接"}
                      </button>
                      <button onClick={() => handleEdit(p)}
                        className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 transition-colors">
                        编辑
                      </button>
                      {deletingId === p.id ? (
                        <div className="flex gap-1.5 ml-auto">
                          <button onClick={() => handleDelete(p.id)} className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600">确认删除</button>
                          <button onClick={() => setDeletingId(null)} className="px-3 py-1.5 text-xs border rounded-lg">取消</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeletingId(p.id)} className="px-3 py-1.5 text-xs border text-red-500 rounded-lg hover:bg-red-50 ml-auto">删除</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Add card */}
              <button
                onClick={() => { setEditingProvider(null); setShowForm(true); }}
                className="border-2 border-dashed border-gray-200 rounded-2xl min-h-[260px] flex flex-col items-center justify-center hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
              >
                <svg className="w-10 h-10 text-muted-foreground/40 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="text-sm text-muted-foreground font-medium">添加提供商</span>
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "usage" && (
        <div>
          {/* Time range */}
          <div className="flex mb-6">
            {[{ d: 7, l: "7天" }, { d: 30, l: "30天" }, { d: 90, l: "90天" }].map((r) => (
              <button key={r.d} onClick={() => setUsageDays(r.d)}
                className={`px-4 py-2 text-sm border transition-colors ${
                  usageDays === r.d ? "bg-primary text-white border-primary" : "bg-white border-gray-200 hover:bg-gray-50"
                } ${r.d === 7 ? "rounded-l-lg" : ""} ${r.d === 90 ? "rounded-r-lg" : ""}`}
              >
                {r.l}
              </button>
            ))}
          </div>

          {/* Summary */}
          {usageSummary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[
                { label: "输入 Tokens", value: usageSummary.totalInputTokens.toLocaleString() },
                { label: "输出 Tokens", value: usageSummary.totalOutputTokens.toLocaleString() },
                { label: "总费用", value: `$${usageSummary.totalCost.toFixed(4)}` },
                { label: "调用次数", value: usageSummary.totalCalls.toLocaleString() },
              ].map((s) => (
                <div key={s.label} className="bg-white border rounded-2xl p-5">
                  <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
                  <div className="text-xl font-bold font-display">{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Usage table */}
          <div className="bg-white border rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">模块</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">输入</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">输出</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">费用</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">日期</th>
                </tr>
              </thead>
              <tbody>
                {usageEntries.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">暂无用量数据</td></tr>
                ) : usageEntries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50/50">
                    <td className="px-5 py-3 text-sm">{e.module}</td>
                    <td className="px-5 py-3 text-sm text-right">{e.inputTokens.toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right">{e.outputTokens.toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-right">{e.costEstimate != null ? `$${e.costEstimate.toFixed(4)}` : "-"}</td>
                    <td className="px-5 py-3 text-sm text-right text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Provider form dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => handleFormClose()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
            <ProviderForm provider={editingProvider} onClose={handleFormClose} />
          </div>
        </div>
      )}
    </div>
  );
}
