"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLocalizedError, useLocale } from "@/lib/i18n";
import { parseCapabilities } from "@/lib/llm/capabilities";
import { getProviderTypeOptions, isLocalProviderType, type ModelProviderType } from "@/lib/models/provider-types";
import type { Provider as ProviderType, ModelConfig as ApiModelConfig } from "./types";

type ContextUnit = "" | "K" | "M";

interface FormModelConfig {
  modelId: string;
  modelName: string;
  modelType: "llm" | "embedding" | "rerank" | "image";
  capabilities: string[];
  contextWindow: number;
  maxOutputTokens: number | null;
  supportsStreaming: boolean;
  inputPrice: number | null;
  outputPrice: number | null;
  isDefaultFor: string | null;
  embeddingBatchSize: number | null;
  embeddingDim: number | null;
}

interface ProviderFormProps {
  provider: ProviderType | null;
  tab: "llm" | "embedding" | "rerank" | "image";
  onClose: () => void;
}

const defaultModel: FormModelConfig = {
  modelId: "",
  modelName: "",
  modelType: "llm",
  capabilities: [],
  contextWindow: 0,
  maxOutputTokens: null,
  supportsStreaming: true,
  inputPrice: null,
  outputPrice: null,
  isDefaultFor: null,
  embeddingBatchSize: 10,
  embeddingDim: null,
};

function toFormModel(m: ApiModelConfig): FormModelConfig {
  const caps = parseCapabilities(m.capabilities);
  const modelType = caps.includes("embedding") || caps.includes("embed") ? "embedding" : caps.includes("rerank") ? "rerank" : caps.includes("image_generation") ? "image" : "llm";
  return {
    modelId: m.modelId,
    modelName: m.modelName,
    modelType,
    capabilities: caps,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    supportsStreaming: m.supportsStreaming,
    inputPrice: m.inputPrice,
    outputPrice: m.outputPrice,
    isDefaultFor: m.isDefaultFor,
    embeddingBatchSize: m.embeddingBatchSize ?? 10,
    embeddingDim: m.embeddingDim ?? null,
  };
}

/** Convert absolute token count → display value + unit for the input field */
function toDisplayValue(ctx: number): { value: string; unit: ContextUnit } {
  if (ctx <= 0) return { value: "", unit: "" };
  // AI context windows use 1000-base (1K = 1000, 1M = 1,000,000)
  if (ctx % 1_000_000 === 0) return { value: String(ctx / 1_000_000), unit: "M" };
  if (ctx % 1_000 === 0 && ctx >= 1_000) return { value: String(ctx / 1_000), unit: "K" };
  return { value: String(ctx), unit: "" };
}

/** Convert display value + unit back to absolute token count */
function toAbsoluteValue(value: string, unit: ContextUnit): number {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 0;
  if (unit === "M") return Math.round(num * 1_000_000);
  if (unit === "K") return Math.round(num * 1000);
  return Math.round(num);
}

export function ProviderForm({ provider, tab, onClose }: ProviderFormProps) {
  const { t } = useLocale();
  const isEdit = !!provider;
  const providerTypeOptions = useMemo(() => getProviderTypeOptions(tab), [tab]);
  const initialProviderType = (
    provider?.providerType && providerTypeOptions.some((option) => option.value === provider.providerType)
      ? provider.providerType
      : providerTypeOptions[0]?.value ?? "ollama"
  ) as ModelProviderType;
  const [name, setName] = useState(provider?.name || "");
  const [providerType, setProviderType] = useState<ModelProviderType>(initialProviderType);
  const [apiBaseUrl, setApiBaseUrl] = useState(provider?.apiBaseUrl || "");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const isLocal = isLocalProviderType(providerType);
  const resolvedModelType = tab === "embedding" ? "embedding" : tab === "rerank" ? "rerank" : tab === "image" ? "image" : "llm" as const;
  const [models, setModels] = useState<FormModelConfig[]>(
    provider?.models?.length
      ? provider.models.map(toFormModel)
      : [{ ...defaultModel, modelType: resolvedModelType }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Per-model context window unit state (for the K/M selector)
  const [contextUnits, setContextUnits] = useState<ContextUnit[]>(
    models.map((m) => toDisplayValue(m.contextWindow).unit)
  );

  function updateModel(index: number, field: string, value: unknown) {
    setModels((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  // ── Catalog auto-fill ────────────────────────────────────────────────
  const catalogTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const fetchCatalogEntry = useCallback(async (index: number, modelId: string) => {
    if (modelId.length < 3) return;
    try {
      const res = await fetch(`/api/v1/models/catalog/lookup?q=${encodeURIComponent(modelId)}`);
      const data = await res.json();
      if (!data.success || !data.data) return;

      const entry = data.data as {
        matchType: string;
        contextWindow: number;
        embeddingDim: number | null;
        maxOutputTokens: number | null;
        mode: string;
      };

      setModels((prev) =>
        prev.map((m, i) => {
          if (i !== index) return m;
          // Only auto-fill fields that are still at their defaults
          const updates: Partial<FormModelConfig> = {};
          if ((m.contextWindow ?? 0) === 0 && entry.contextWindow > 0) {
            updates.contextWindow = entry.contextWindow;
            // Update the unit selector to match
            setContextUnits((prev) => {
              const next = [...prev];
              next[index] = toDisplayValue(entry.contextWindow).unit;
              return next;
            });
          }
          if (m.embeddingDim === null && entry.embeddingDim !== null && entry.embeddingDim > 0) {
            updates.embeddingDim = entry.embeddingDim;
          }
          if (m.maxOutputTokens === null && entry.maxOutputTokens !== null && entry.maxOutputTokens > 0) {
            updates.maxOutputTokens = entry.maxOutputTokens;
          }
          return Object.keys(updates).length > 0 ? { ...m, ...updates } : m;
        }),
      );
    } catch {
      // silent — catalog is best-effort
    }
  }, []);

  /** Called when the user changes a modelId input */
  function handleModelIdChange(index: number, value: string) {
    updateModel(index, "modelId", value);

    // Debounce catalog lookup
    const existing = catalogTimers.current.get(index);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => fetchCatalogEntry(index, value), 500);
    catalogTimers.current.set(index, timer);
  }

  // Clean up timers on unmount
  useEffect(() => {
    const timers = catalogTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  function updateContextUnit(index: number, unit: ContextUnit) {
    setContextUnits((prev) => {
      const next = [...prev];
      next[index] = unit;
      return next;
    });
    // Re-convert current display value with new unit
    const m = models[index];
    const display = toDisplayValue(m.contextWindow);
    const currentDisplayValue = display.unit === unit ? display.value : "";
    // If switching units, try to keep a sensible value
    if (currentDisplayValue && m.contextWindow > 0) {
      const newAbsolute = toAbsoluteValue(currentDisplayValue, unit);
      if (newAbsolute > 0) {
        updateModel(index, "contextWindow", newAbsolute);
      }
    }
  }

  function updateContextValue(index: number, rawValue: string) {
    const unit = contextUnits[index] || "";
    const absolute = toAbsoluteValue(rawValue, unit);
    updateModel(index, "contextWindow", absolute);
  }

  /** Get the display value for the context window input */
  function getContextDisplayValue(index: number): string {
    const m = models[index];
    const display = toDisplayValue(m.contextWindow);
    // If current unit matches the auto-detected unit, use the display value
    if (contextUnits[index] === display.unit && display.value) return display.value;
    // If user has selected a unit and there's a contextWindow, convert
    if (m.contextWindow > 0 && contextUnits[index]) {
      const unit = contextUnits[index];
      if (unit === "M") return String(m.contextWindow / 1_000_000);
      if (unit === "K") return String(m.contextWindow / 1000);
    }
    // No unit selected, show raw number
    if (m.contextWindow > 0 && !contextUnits[index]) return String(m.contextWindow);
    return "";
  }

  function addModel() {
    setModels((prev) => [...prev, { ...defaultModel, modelType: resolvedModelType }]);
    setContextUnits((prev) => [...prev, ""]);
  }

  function removeModel(index: number) {
    if (models.length <= 1) return;
    setModels((prev) => prev.filter((_, i) => i !== index));
    setContextUnits((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    const cleanModels = models.map((m) => {
      const caps = m.modelType === "embedding" ? ["embedding"] : m.modelType === "rerank" ? ["rerank"] : m.modelType === "image" ? ["image_generation"] : ["chat"];
      const cleaned: Record<string, unknown> = {
        ...m,
        capabilities: caps,
        modelType: undefined,
        embeddingBatchSize: m.modelType === "embedding" ? m.embeddingBatchSize : undefined,
        embeddingDim: m.modelType === "embedding" ? m.embeddingDim : undefined,
      };
      delete cleaned.modelType;
      for (const [k, v] of Object.entries(cleaned)) {
        if (v === null || v === undefined) delete cleaned[k];
      }
      return cleaned;
    });
    const payload = { name, providerType, apiBaseUrl, apiKey: apiKey || undefined, models: cleanModels };

    try {
      const url = isEdit ? `/api/v1/models/providers/${provider.id}` : "/api/v1/models/providers";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        onClose();
      } else {
        setError(getLocalizedError(data, t.errors, t.models.form.saveFailed));
      }
    } catch {
      setError(t.common.messages.networkError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-6">
      <h2 className="text-lg font-semibold font-display mb-6">{isEdit ? t.models.form.editProviderTitle : t.models.form.addProviderTitle}</h2>

      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.models.providers.name}</label>
          <input className="w-full px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
            value={name} onChange={(e) => setName(e.target.value)} placeholder={t.models.form.providerNamePlaceholder} required />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.models.form.type}</label>
          <Select value={providerType} onValueChange={(v) => setProviderType(v as ModelProviderType)}>
            <SelectTrigger className="w-full text-sm">
              <SelectValue>{(v: string | null) => {
                return providerTypeOptions.find((option) => option.value === v)?.label ?? v;
              }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {providerTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.models.providers.apiBaseUrl}</label>
          <input className="w-full px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
            value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="http://localhost:11434" required />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">
            {t.models.providers.apiKey} {!isLocal && !isEdit && <span className="text-destructive">*</span>}
          </label>
          <div className="relative">
            <input type={showApiKey ? "text" : "password"} className="w-full px-3.5 py-2.5 pr-10 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
              value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? t.models.form.leaveEmptyKeepCurrent : isLocal ? t.models.form.optionalForLocal : t.models.form.enterApiKey}
              required={!isLocal && !isEdit} />
            <button type="button" onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              tabIndex={-1}>
              {showApiKey ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Models */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t.models.models.modelConfiguration}</h3>
          <button type="button" onClick={addModel} className="text-xs text-primary hover:underline">+ {t.models.models.addModel}</button>
        </div>
        <div className="space-y-4">
          {models.map((m, i) => (
            <div key={i} className="border border-border rounded-xl p-5 bg-muted/50">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t.models.models.modelId}</label>
                  <input className="w-full px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
                    value={m.modelId} onChange={(e) => handleModelIdChange(i, e.target.value)} placeholder={m.modelType === "image" ? "e.g. dall-e-3" : "e.g. qwen2.5:7b"} required />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{t.models.models.modelName}</label>
                  <input className="w-full px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
                    value={m.modelName} onChange={(e) => updateModel(i, "modelName", e.target.value)} placeholder={m.modelType === "image" ? "e.g. DALL-E 3" : "e.g. Qwen 2.5 7B"} required />
                </div>
              </div>
              {m.modelType !== "image" && (
                <div className="mt-3">
                  <label className="block text-xs text-muted-foreground mb-1">
                    {m.modelType === "embedding"
                      ? t.models.models.embeddingMaxTokens
                      : t.models.models.contextWindow}
                    {" "}
                    <span className="font-normal">
                      ({m.modelType === "embedding"
                        ? t.models.models.embeddingMaxTokensDesc
                        : t.models.models.contextWindowDesc})
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="flex-1 px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
                      value={getContextDisplayValue(i)}
                      onChange={(e) => updateContextValue(i, e.target.value)}
                      placeholder={m.modelType === "embedding" ? "e.g. 8" : "e.g. 128"}
                    />
                    <Select
                      value={contextUnits[i] || "_none"}
                      onValueChange={(v) => updateContextUnit(i, v === "_none" ? "" : v as ContextUnit)}
                    >
                      <SelectTrigger className="w-[80px] text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">—</SelectItem>
                        <SelectItem value="K">K</SelectItem>
                        <SelectItem value="M">M</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {m.contextWindow > 0
                      ? `= ${m.contextWindow.toLocaleString()} tokens`
                      : m.modelType === "embedding"
                        ? t.models.models.embeddingMaxTokensDefault
                        : t.models.models.contextWindowDefault}
                  </p>
                </div>
              )}
               {m.modelType === "rerank" && (
                <div className="mt-3 px-3 py-2 bg-purple-50 border border-purple-100 rounded-lg">
                  <p className="text-xs text-purple-700">{t.models.form.rerankDesc}</p>
                </div>
               )}
               {m.modelType === "image" && (
                <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
                  <p className="text-xs text-blue-700">{t.models.form.imageDesc}</p>
                </div>
              )}
               {m.modelType === "embedding" && (
                <>
                  <div className="mt-3">
                    <label className="block text-xs text-muted-foreground mb-1">
                      {t.models.models.embeddingBatchSize} <span className="font-normal">({t.models.models.embeddingBatchSizeDesc})</span>
                    </label>
                    <input type="text" inputMode="numeric" className="w-full px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
                      value={m.embeddingBatchSize ?? 10} onChange={(e) => updateModel(i, "embeddingBatchSize", parseInt(e.target.value, 10) || 10)} placeholder="10" />
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs text-muted-foreground mb-1">
                      {t.models.models.embeddingDim} <span className="font-normal">({t.models.models.embeddingDimDesc})</span>
                    </label>
                    <input type="text" inputMode="numeric" className="w-full px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
                      value={m.embeddingDim ?? ""} onChange={(e) => updateModel(i, "embeddingDim", parseInt(e.target.value, 10) || null)} placeholder={t.models.models.embeddingDimPlaceholder} />
                  </div>
                </>
               )}
              {models.length > 1 && (
                <button type="button" onClick={() => removeModel(i)} className="text-xs text-red-500 hover:underline mt-2">{t.common.actions.remove}</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onClose} className="px-5 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/70 text-foreground/75 transition-colors">{t.common.actions.cancel}</button>
        <button type="submit" disabled={saving}
          className="px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-all shadow-sm disabled:opacity-50">
          {saving ? t.common.actions.loading : isEdit ? t.common.actions.update : t.common.actions.create}
        </button>
      </div>
    </form>
  );
}
