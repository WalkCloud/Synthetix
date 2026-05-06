"use client";

import { useState } from "react";
import type { Provider as ProviderType, ModelConfig as ApiModelConfig } from "./types";

interface FormModelConfig {
  modelId: string;
  modelName: string;
  modelType: "llm" | "embedding";
  capabilities: string[];
  contextWindow: number;
  maxOutputTokens: number | null;
  supportsStreaming: boolean;
  inputPrice: number | null;
  outputPrice: number | null;
  isDefaultFor: string | null;
}

interface ProviderFormProps {
  provider: ProviderType | null;
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
};

function parseCapabilities(raw: string): string[] {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function toFormModel(m: ApiModelConfig): FormModelConfig {
  const caps = parseCapabilities(m.capabilities);
  const modelType = caps.includes("embedding") || caps.includes("embed") ? "embedding" : "llm";
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
  };
}

export function ProviderForm({ provider, onClose }: ProviderFormProps) {
  const isEdit = !!provider;
  const [name, setName] = useState(provider?.name || "");
  const [providerType, setProviderType] = useState(provider?.providerType || "ollama");
  const [apiBaseUrl, setApiBaseUrl] = useState(provider?.apiBaseUrl || "");
  const [apiKey, setApiKey] = useState(provider?.apiKey || "");
  const isLocal = providerType === "ollama" || providerType === "custom";
  const [models, setModels] = useState<FormModelConfig[]>(
    provider?.models?.length ? provider.models.map(toFormModel) : [{ ...defaultModel }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateModel(index: number, field: string, value: unknown) {
    setModels((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  function addModel() {
    setModels((prev) => [...prev, { ...defaultModel }]);
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
      const caps = m.modelType === "embedding" ? ["embedding"] : ["chat"];
      const cleaned: Record<string, unknown> = {
        ...m,
        capabilities: caps,
        modelType: undefined,
      };
      delete cleaned.modelType;
      for (const [k, v] of Object.entries(cleaned)) {
        if (v !== null) cleaned[k] = v;
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
          : data.error?.formErrors?.[0] ?? "保存失败";
        setError(msg);
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-6">
      <h2 className="text-lg font-semibold font-display mb-6">{isEdit ? "编辑提供商" : "添加提供商"}</h2>

      {error && <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">提供商名称</label>
          <input className="w-full px-3.5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Ollama" required />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">类型</label>
          <select className="w-full px-3.5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            value={providerType} onChange={(e) => setProviderType(e.target.value)}>
            <option value="ollama">Ollama</option>
            <option value="openai_compatible">OpenAI Compatible</option>
            <option value="anthropic">Anthropic</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">API 地址</label>
          <input className="w-full px-3.5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="http://localhost:11434" required />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">
            API Key {!isLocal && !isEdit && <span className="text-destructive">*</span>}
          </label>
          <input type="password" className="w-full px-3.5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={isEdit ? "留空则不修改" : isLocal ? "本地服务可不填" : "输入 API Key"}
            required={!isLocal && !isEdit} />
        </div>
      </div>

      {/* Models */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">模型配置</h3>
          <button type="button" onClick={addModel} className="text-xs text-primary hover:underline">+ 添加模型</button>
        </div>
        <div className="space-y-4">
          {models.map((m, i) => (
            <div key={i} className="border border-[#E4E4E7] rounded-xl p-4 bg-[#FAFAFA]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">模型 ID</label>
                  <input className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={m.modelId} onChange={(e) => updateModel(i, "modelId", e.target.value)} placeholder="e.g. qwen2.5:7b" required />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">模型名称</label>
                  <input className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={m.modelName} onChange={(e) => updateModel(i, "modelName", e.target.value)} placeholder="e.g. Qwen 2.5 7B" required />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">模型类型</label>
                  <select className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={m.modelType} onChange={(e) => updateModel(i, "modelType", e.target.value)}>
                    <option value="llm">LLM 大语言模型</option>
                    <option value="embedding">Embedding 嵌入模型</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">上下文窗口 <span className="font-normal">(选填，Test 时自动检测)</span></label>
                  <input type="text" inputMode="numeric" className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={m.contextWindow || ""} onChange={(e) => updateModel(i, "contextWindow", parseInt(e.target.value, 10) || 0)} placeholder="e.g. 4096" />
                </div>
              </div>
              {models.length > 1 && (
                <button type="button" onClick={() => removeModel(i)} className="text-xs text-red-500 hover:underline mt-2">移除</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onClose} className="px-5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm font-medium hover:bg-[#F4F4F5]">取消</button>
        <button type="submit" disabled={saving}
          className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-light transition-all disabled:opacity-50">
          {saving ? "保存中..." : isEdit ? "更新" : "创建"}
        </button>
      </div>
    </form>
  );
}
