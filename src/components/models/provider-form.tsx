"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/lib/i18n";
import { parseCapabilities } from "@/lib/llm/capabilities";
import type { Provider as ProviderType, ModelConfig as ApiModelConfig } from "./types";

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

export function ProviderForm({ provider, tab, onClose }: ProviderFormProps) {
  const { t } = useLocale();
  const isEdit = !!provider;
  const [name, setName] = useState(provider?.name || "");
  const [providerType, setProviderType] = useState(provider?.providerType || "ollama");
  const [apiBaseUrl, setApiBaseUrl] = useState(provider?.apiBaseUrl || "");
  const [apiKey, setApiKey] = useState("");
  const isLocal = providerType === "ollama" || providerType === "custom";
  const resolvedModelType = tab === "embedding" ? "embedding" : tab === "rerank" ? "rerank" : tab === "image" ? "image" : "llm" as const;
  const [models, setModels] = useState<FormModelConfig[]>(
    provider?.models?.length
      ? provider.models.map(toFormModel)
      : [{ ...defaultModel, modelType: resolvedModelType }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateModel(index: number, field: string, value: unknown) {
    setModels((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  function addModel() {
    setModels((prev) => [...prev, { ...defaultModel, modelType: resolvedModelType }]);
  }

  function removeModel(index: number) {
    if (models.length <= 1) return;
    setModels((prev) => prev.filter((_, i) => i !== index));
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
        const msg = typeof data.error === "string"
          ? data.error
          : data.error?.formErrors?.[0] ?? t.models.form.saveFailed;
        setError(msg);
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
          <Select value={providerType} onValueChange={(v) => setProviderType(v!)}>
            <SelectTrigger className="w-full text-sm">
              <SelectValue>{(v: string | null) => {
                const labels: Record<string, string> = { ollama: 'Ollama', openai_compatible: 'OpenAI Compatible', anthropic: 'Anthropic', custom: 'Custom' };
                return labels[v ?? ''] ?? v;
              }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ollama">Ollama</SelectItem>
              <SelectItem value="openai_compatible">OpenAI Compatible</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
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
          <input type="password" className="w-full px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
            value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={isEdit ? t.models.form.leaveEmptyKeepCurrent : isLocal ? t.models.form.optionalForLocal : t.models.form.enterApiKey}
            required={!isLocal && !isEdit} />
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
                    value={m.modelId} onChange={(e) => updateModel(i, "modelId", e.target.value)} placeholder={m.modelType === "image" ? "e.g. dall-e-3" : "e.g. qwen2.5:7b"} required />
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
                    {t.models.models.contextWindow} <span className="font-normal">({t.models.models.contextWindowDesc})</span>
                  </label>
                  <input type="text" inputMode="numeric" className="w-full px-3.5 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-card shadow-sm transition-all"
                    value={m.contextWindow || ""} onChange={(e) => updateModel(i, "contextWindow", parseInt(e.target.value, 10) || 0)} placeholder="e.g. 4096" />
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
