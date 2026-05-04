"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ProviderForm } from "./provider-form";
import type { Provider, UsageEntry, UsageSummary } from "./types";

type Tab = "llm" | "embedding" | "usage";

type TimeRange = "today" | "week" | "month" | "custom";

interface CapabilityTag {
  label: string;
  color: "blue" | "green" | "purple" | "orange";
}

interface IconColors {
  bg: string;
  text: string;
}

const CAPABILITY_MAP: Record<string, CapabilityTag> = {
  chat: { label: "chat", color: "blue" },
  writing: { label: "writing", color: "green" },
  summarization: { label: "summarization", color: "purple" },
  vision: { label: "vision", color: "orange" },
  diagram_generation: { label: "diagram_generation", color: "orange" },
  splitting: { label: "splitting", color: "orange" },
  rerank: { label: "rerank", color: "purple" },
};

const TAG_CLASSES: Record<string, string> = {
  purple: "bg-primary-100 text-primary",
  green: "bg-[#DCFCE7] text-[#16A34A]",
  orange: "bg-[#FFF7ED] text-[#EA580C]",
  blue: "bg-[#EFF6FF] text-[#2563EB]",
  gray: "bg-base-gray text-muted-foreground",
};

const PROVIDER_TAG_CLASSES: Record<string, string> = {
  ollama: "bg-primary-100 text-primary",
  openai_compatible: "bg-[#EFF6FF] text-[#2563EB]",
  openai: "bg-[#EFF6FF] text-[#2563EB]",
  anthropic: "bg-[#FFF7ED] text-[#EA580C]",
  custom: "bg-base-gray text-muted-foreground",
};

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
  custom: 30,
};

// --- Placeholder data for embedding tab (no API yet) ---

interface EmbeddingModel {
  name: string;
  iconColors: IconColors;
  isDefault: boolean;
  provider: string;
  localOrCloud: string;
  endpoint: string;
  specs: { vectorDimensions: number; contextWindow: number; indexedDocs: number; totalVectors: number };
  pricing: { free: boolean; inputPrice?: number; outputPrice?: number };
}

const PLACEHOLDER_EMBEDDINGS: EmbeddingModel[] = [
  {
    name: "Nomic Embed Text",
    iconColors: { bg: "bg-[#FFF7ED]", text: "text-[#EA580C]" },
    isDefault: true,
    provider: "ollama",
    localOrCloud: "Local",
    endpoint: "localhost:11434",
    specs: { vectorDimensions: 768, contextWindow: 8192, indexedDocs: 12, totalVectors: 45230 },
    pricing: { free: true },
  },
  {
    name: "text-embedding-3-small",
    iconColors: { bg: "bg-[#EFF6FF]", text: "text-[#2563EB]" },
    isDefault: false,
    provider: "openai",
    localOrCloud: "Cloud",
    endpoint: "API Key: sk-...xxxx",
    specs: { vectorDimensions: 1536, contextWindow: 8191, indexedDocs: 0, totalVectors: 0 },
    pricing: { free: false, inputPrice: 0.02, outputPrice: 0.02 },
  },
];

// --- Placeholder data for usage charts ---

interface UsageByModel {
  name: string;
  tokens: number;
  cost: string;
  percentage: number;
  gradient: string;
}

interface UsageByFeature {
  name: string;
  tokens: number;
  cost: string;
  percentage: number;
  tagColor: string;
}

interface UsageByDocument {
  name: string;
  chapters: string;
  totalTokens: number;
  cost: string;
  lastActivity: string;
}

const PLACEHOLDER_USAGE_MODELS: UsageByModel[] = [
  { name: "GPT-4o", tokens: 1245000, cost: "$64.20", percentage: 80, gradient: "bg-gradient-to-r from-primary to-primary-light" },
  { name: "Claude Sonnet 4", tokens: 892000, cost: "$45.80", percentage: 58, gradient: "bg-gradient-to-r from-accent to-accent-light" },
  { name: "Qwen2.5:7B", tokens: 312000, cost: "Free (Local)", percentage: 22, gradient: "bg-gradient-to-r from-[#16A34A] to-[#22C55E]" },
  { name: "Nomic Embed Text", tokens: 7789, cost: "Free (Local)", percentage: 4, gradient: "bg-gradient-to-r from-primary to-primary-light" },
];

const PLACEHOLDER_USAGE_FEATURES: UsageByFeature[] = [
  { name: "Document Writing", tokens: 1678000, cost: "$89.20", percentage: 68.3, tagColor: "bg-primary-100 text-primary" },
  { name: "Document Init", tokens: 456000, cost: "$12.30", percentage: 18.6, tagColor: "bg-[#EFF6FF] text-[#2563EB]" },
  { name: "Brainstorming", tokens: 234000, cost: "$18.90", percentage: 9.5, tagColor: "bg-[#FFF7ED] text-[#EA580C]" },
  { name: "Embedding", tokens: 88789, cost: "$7.05", percentage: 3.6, tagColor: "bg-[#DCFCE7] text-[#16A34A]" },
];

const TREND_DATA = [40, 55, 35, 70, 60, 80, 65, 90, 75, 85, 95, 100, 70, 60];
const TREND_LABELS = ["Apr 19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "May 1", "2"];

const PLACEHOLDER_USAGE_DOCS: UsageByDocument[] = [
  { name: "API Design Specification", chapters: "8 / 12", totalTokens: 1892000, cost: "$98.40", lastActivity: "2 hours ago" },
  { name: "Quarterly Business Review", chapters: "3 / 6", totalTokens: 345000, cost: "$18.60", lastActivity: "Yesterday" },
  { name: "Product Research Report", chapters: "1 / 5", totalTokens: 156000, cost: "$8.20", lastActivity: "3 days ago" },
  { name: "System Architecture Overview", chapters: "0 / 4", totalTokens: 63789, cost: "$2.25", lastActivity: "1 week ago" },
];

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function parseCapabilities(raw: string): CapabilityTag[] {
  if (!raw) return [];
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return items
    .map((item) => CAPABILITY_MAP[item])
    .filter((c): c is CapabilityTag => c !== undefined);
}

function parseDefaultFor(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseContextWindow(n: number | null): string {
  if (n === null || n === 0) return "-";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function parseMaxOutput(n: number | null): string {
  if (n === null || n === 0) return "-";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// --- Sub-components ---

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${TAG_CLASSES[color] ?? TAG_CLASSES.gray}`}>
      {label}
    </span>
  );
}

function DefaultBadge({ text }: { text: string }) {
  return (
    <span className="text-[10px] font-semibold bg-[#FEF3C7] text-[#D97706] px-1.5 py-px rounded-full leading-tight">
      Default: {text}
    </span>
  );
}

function ConnectionStatus({ active }: { active: boolean }) {
  if (!active) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-[#EA580C]">
        <span className="w-2 h-2 rounded-full bg-[#EA580C]" />
        Disconnected
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-[#16A34A]">
      <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
      Connected
    </span>
  );
}

function ProviderTag({ type }: { type: string }) {
  const cls = PROVIDER_TAG_CLASSES[type] ?? PROVIDER_TAG_CLASSES.custom;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}>
      {type === "openai_compatible" ? "openai" : type}
    </span>
  );
}

function LocalCloudTag({ value }: { value: string }) {
  const isLocal = value.toLowerCase() === "local";
  const cls = isLocal
    ? "bg-[#DCFCE7] text-[#16A34A]"
    : "bg-[#FFF7ED] text-[#EA580C]";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}>
      {isLocal ? "Local" : "Cloud"}
    </span>
  );
}

function ProviderEndpoint({ url, isLocal }: { url: string; isLocal: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
      {isLocal ? (
        <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      )}
      {url}
    </span>
  );
}

function ModelPricing({ inputPrice, outputPrice }: { inputPrice: number | null; outputPrice: number | null }) {
  const isFree = inputPrice === null && outputPrice === null;
  return (
    <div className={`flex items-center gap-1.5 text-xs mt-2.5 ${isFree ? "text-[#16A34A]" : "text-muted-foreground"}`}>
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12c0 1.1.9 2 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
      </svg>
      {isFree
        ? "Free (Local)"
        : `$${inputPrice?.toFixed(2) ?? "0.00"} / $${outputPrice?.toFixed(2) ?? "0.00"} per 1M tokens`}
    </div>
  );
}

function ModelCardActions({
  onTest,
  onEdit,
  onDelete,
  testing,
  testResultContent,
  deleting,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  testing: boolean;
  testResultContent: React.ReactNode;
  deleting: boolean;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  return (
    <div>
      {testResultContent}
      <div className="flex gap-2 mt-3.5">
        <button
          onClick={onTest}
          disabled={testing}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium border border-border rounded-[var(--radius-md)] bg-white hover:bg-base-gray transition-colors disabled:opacity-40"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {testing ? "Testing..." : "Test"}
        </button>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground rounded-[var(--radius-md)] hover:bg-base-gray transition-colors"
        >
          Edit
        </button>
        {deleting ? (
          <>
            <button
              onClick={onDeleteConfirm}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium bg-destructive text-white rounded-[var(--radius-md)] hover:bg-red-600 transition-colors ml-auto"
            >
              Confirm
            </button>
            <button
              onClick={onDeleteCancel}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium border border-border rounded-[var(--radius-md)] hover:bg-base-gray transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium text-destructive rounded-[var(--radius-md)] hover:bg-red-50 transition-colors ml-auto"
          >
            Delete
          </button>
        )}
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
  const [testResult, setTestResult] = useState<{ id: string; connected: boolean; models?: string[]; error?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Usage state
  const [timeRange, setTimeRange] = useState<TimeRange>("month");
  const [usageEntries, setUsageEntries] = useState<UsageEntry[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/models/providers");
      const data = await res.json();
      if (data.success) setProviders(data.data);
    } catch {
      // Failed to fetch providers - state remains empty
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsage = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/v1/models/usage?days=${days}`);
      const data = await res.json();
      if (data.success) {
        setUsageEntries(data.data.usage);
        setUsageSummary(data.data.summary);
      }
    } catch {
      // Failed to fetch usage - state remains empty
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
    try {
      const res = await fetch(`/api/v1/models/providers/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setTestResult({ id, ...data.data });
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

  // Flatten providers into individual model cards for the LLM tab
  const llmModels = useMemo(() => {
    const result: Array<{
      provider: Provider;
      modelIndex: number;
      iconColors: IconColors;
    }> = [];
    providers.forEach((p) => {
      p.models.forEach((m, idx) => {
        const colorIdx = result.length % MODEL_ICON_COLORS.length;
        result.push({ provider: p, modelIndex: idx, iconColors: MODEL_ICON_COLORS[colorIdx] });
      });
    });
    return result;
  }, [providers]);

  // --- Render helpers ---

  const renderLlmModelCard = (
    provider: Provider,
    modelIndex: number,
    iconColors: IconColors,
  ) => {
    const model = provider.models[modelIndex];
    const capabilities = parseCapabilities(model.capabilities);
    const defaults = parseDefaultFor(model.isDefaultFor);
    const isLocal = (model.localOrCloud ?? "").toLowerCase() === "local";
    const isActive = provider.isActive;
    const isTesting = testingId === provider.id;
    const isDeleting = deletingId === provider.id;

    const testResultContent = testResult?.id === provider.id && (
      <div className={`mb-3 px-3 py-2 rounded-xl text-xs ${testResult.connected ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-red-50 text-red-600"}`}>
        {testResult.connected
          ? `Connected${testResult.models?.length ? `, found ${testResult.models.length} models` : ""}`
          : `Connection failed${testResult.error ? `: ${testResult.error}` : ""}`}
      </div>
    );

    return (
      <div
        key={`${provider.id}-${model.id}`}
        className="bg-white border border-border rounded-2xl overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all"
        style={{ animation: "fadeInUp 0.4s ease both" }}
      >
        <div className="p-6">
          {/* Header: icon + name + badges + status */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconColors.bg} ${iconColors.text}`}>
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <div className="text-base font-bold leading-tight">{model.modelName}</div>
                {defaults.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-1">
                    {defaults.map((d) => (
                      <DefaultBadge key={d} text={d} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <ConnectionStatus active={isActive} />
          </div>

          {/* Provider row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3.5">
            <ProviderTag type={provider.providerType} />
            <LocalCloudTag value={model.localOrCloud ?? "cloud"} />
            <ProviderEndpoint
              url={isLocal ? provider.apiBaseUrl.replace(/^https?:\/\//, "") : `API Key: ${provider.apiKey ? `${provider.apiKey.slice(0, 3)}...${provider.apiKey.slice(-4)}` : "not set"}`}
              isLocal={isLocal}
            />
          </div>

          {/* Capability tags */}
          {capabilities.length > 0 && (
            <div className="flex gap-1 flex-wrap mb-3">
              {capabilities.map((cap) => (
                <Tag key={cap.label} label={cap.label} color={cap.color} />
              ))}
            </div>
          )}

          {/* Meta bar */}
          <div className="flex gap-3 flex-wrap text-xs text-muted-foreground py-3 border-t border-b border-border/60">
            <span className="flex items-center gap-1">
              <svg className="w-[13px] h-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Context: {parseContextWindow(model.contextWindow)}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-[13px] h-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Max Output: {parseMaxOutput(model.maxOutputTokens)}
            </span>
            {model.supportsStreaming && (
              <span className="text-[#16A34A]">Streaming</span>
            )}
          </div>

          {/* Pricing */}
          <ModelPricing inputPrice={model.inputPrice} outputPrice={model.outputPrice} />

          {/* Actions */}
          <ModelCardActions
            onTest={() => handleTest(provider.id)}
            onEdit={() => handleEdit(provider)}
            onDelete={() => setDeletingId(provider.id)}
            testing={isTesting}
            testResultContent={testResultContent}
            deleting={isDeleting}
            onDeleteConfirm={() => handleDelete(provider.id)}
            onDeleteCancel={() => setDeletingId(null)}
          />
        </div>
      </div>
    );
  };

  const renderEmbeddingCard = (em: EmbeddingModel, idx: number) => {
    const isLocal = em.localOrCloud === "Local";
    return (
      <div
        key={em.name}
        className="bg-white border border-border rounded-2xl overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all"
        style={{ animation: `fadeInUp 0.4s ease both ${idx * 0.05}s` }}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${em.iconColors.bg} ${em.iconColors.text}`}>
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 7h10" /><path d="M7 12h10" /><path d="M7 17h6" />
                </svg>
              </div>
              <div>
                <div className="text-base font-bold leading-tight">{em.name}</div>
                {em.isDefault && (
                  <div className="flex gap-1 flex-wrap mt-1">
                    <DefaultBadge text="Embedding" />
                  </div>
                )}
              </div>
            </div>
            <ConnectionStatus active={true} />
          </div>

          {/* Provider row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3.5">
            <ProviderTag type={em.provider} />
            <LocalCloudTag value={em.localOrCloud} />
            <ProviderEndpoint url={em.endpoint} isLocal={isLocal} />
          </div>

          {/* Spec grid */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="p-2 px-3 bg-base-gray rounded-lg">
              <div className="text-[11px] text-muted-foreground mb-0.5">Vector Dimensions</div>
              <div className="text-[13px] font-semibold">{formatNumber(em.specs.vectorDimensions)}</div>
            </div>
            <div className="p-2 px-3 bg-base-gray rounded-lg">
              <div className="text-[11px] text-muted-foreground mb-0.5">Context Window</div>
              <div className="text-[13px] font-semibold">{formatNumber(em.specs.contextWindow)}</div>
            </div>
            <div className="p-2 px-3 bg-base-gray rounded-lg">
              <div className="text-[11px] text-muted-foreground mb-0.5">Indexed Docs</div>
              <div className="text-[13px] font-semibold">{formatNumber(em.specs.indexedDocs)}</div>
            </div>
            <div className="p-2 px-3 bg-base-gray rounded-lg">
              <div className="text-[11px] text-muted-foreground mb-0.5">Total Vectors</div>
              <div className="text-[13px] font-semibold">{formatNumber(em.specs.totalVectors)}</div>
            </div>
          </div>

          {/* Pricing */}
          <ModelPricing inputPrice={em.pricing.free ? null : (em.pricing.inputPrice ?? null)} outputPrice={em.pricing.free ? null : (em.pricing.outputPrice ?? null)} />

          {/* Actions */}
          <div className="flex gap-2 mt-3.5">
            <button className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium border border-border rounded-[var(--radius-md)] bg-white hover:bg-base-gray transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Test
            </button>
            <button className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground rounded-[var(--radius-md)] hover:bg-base-gray transition-colors">
              Edit
            </button>
            <button className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium text-destructive rounded-[var(--radius-md)] hover:bg-red-50 transition-colors ml-auto">
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderAddCard = (title: string, subtitle: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="border-2 border-dashed border-border rounded-2xl min-h-[260px] flex flex-col items-center justify-center hover:border-primary/40 hover:bg-primary-50 transition-all cursor-pointer group"
      style={{ animation: "fadeInUp 0.4s ease both 0.2s" }}
    >
      <svg className="w-10 h-10 text-muted-foreground/40 mb-3 group-hover:text-primary/60 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span className="text-[15px] font-semibold text-muted-foreground mb-1">{title}</span>
      <span className="text-[13px] text-muted-foreground/70">{subtitle}</span>
    </button>
  );

  return (
    <div>
      {/* Tab headers - border-bottom style matching prototype */}
      <div className="flex gap-0 border-b border-border mb-6">
        {(["llm", "embedding", "usage"] as const).map((t) => {
          const labels: Record<Tab, string> = {
            llm: "LLM Models",
            embedding: "Embedding Models",
            usage: "Token Usage",
          };
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
            Configure LLM models for writing, chat, brainstorming, splitting, summarization, and other generation tasks. Each model can be assigned as the default for specific capabilities.
          </p>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
              {llmModels.map(({ provider, modelIndex, iconColors }) =>
                renderLlmModelCard(provider, modelIndex, iconColors),
              )}
              {renderAddCard(
                "Add LLM Model",
                "Connect Ollama, OpenAI, Anthropic, or custom endpoint",
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
            {PLACEHOLDER_EMBEDDINGS.map((em, idx) => renderEmbeddingCard(em, idx))}
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
          {/* Time range header */}
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-base font-bold font-[var(--font-display,Urbanist),sans-serif]">Token Usage Overview</h3>
            <div className="flex">
              {(["today", "week", "month", "custom"] as const).map((range, idx) => {
                const labels: Record<TimeRange, string> = { today: "Today", week: "This Week", month: "This Month", custom: "Custom" };
                const isActive = timeRange === range;
                const radiusClass =
                  idx === 0
                    ? "rounded-l-xl"
                    : idx === 3
                      ? "rounded-r-xl"
                      : "";
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

          {/* Stats cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            {/* Total Tokens */}
            <div className="bg-white border border-border rounded-2xl p-6 flex items-start gap-4 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-primary-100 text-primary flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] text-muted-foreground mb-1">Total Tokens</div>
                <div className="text-[28px] font-bold leading-tight font-[var(--font-display,Urbanist),sans-serif]">
                  {usageSummary
                    ? formatNumber(usageSummary.totalInputTokens + usageSummary.totalOutputTokens)
                    : "2,456,789"}
                </div>
              </div>
            </div>

            {/* Total Cost */}
            <div className="bg-white border border-border rounded-2xl p-6 flex items-start gap-4 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] text-muted-foreground mb-1">Total Cost</div>
                <div className="text-[28px] font-bold leading-tight font-[var(--font-display,Urbanist),sans-serif]">
                  {usageSummary ? `$${usageSummary.totalCost.toFixed(2)}` : "$127.45"}
                </div>
              </div>
            </div>

            {/* Avg Daily Usage */}
            <div className="bg-white border border-border rounded-2xl p-6 flex items-start gap-4 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#FFF7ED] text-[#EA580C] flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] text-muted-foreground mb-1">Avg Daily Usage</div>
                <div className="text-[28px] font-bold leading-tight font-[var(--font-display,Urbanist),sans-serif]">
                  {usageSummary && usageDays > 0
                    ? formatNumber(Math.round((usageSummary.totalInputTokens + usageSummary.totalOutputTokens) / usageDays))
                    : "81,893"}
                </div>
              </div>
            </div>

            {/* Active Models */}
            <div className="bg-white border border-border rounded-2xl p-6 flex items-start gap-4 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" />
                </svg>
              </div>
              <div>
                <div className="text-[13px] text-muted-foreground mb-1">Active Models</div>
                <div className="text-[28px] font-bold leading-tight font-[var(--font-display,Urbanist),sans-serif]">
                  {llmModels.length || 5}
                </div>
              </div>
            </div>
          </div>

          {/* Usage by Model - horizontal bar chart */}
          <div className="bg-white border border-border rounded-2xl mb-5 hover:shadow-md transition-all">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-base font-semibold">Usage by Model</h3>
            </div>
            <div className="p-6">
              {PLACEHOLDER_USAGE_MODELS.map((m) => (
                <div key={m.name} className="mb-4.5 last:mb-0">
                  <div className="flex justify-between text-[13px] mb-1.5">
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-muted-foreground">{formatNumber(m.tokens)} tokens &middot; {m.cost}</span>
                  </div>
                  <div className="h-7 bg-black/[0.04] rounded-xl overflow-hidden">
                    <div className={`h-full rounded-xl flex items-center pl-2.5 text-xs font-semibold text-foreground min-w-fit ${m.gradient}`} style={{ width: `${m.percentage}%` }}>
                      {m.percentage}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Usage by Feature + Daily Trend (2-column) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* Usage by Feature table */}
            <div className="bg-white border border-border rounded-2xl hover:shadow-md transition-all">
              <div className="flex items-center justify-between p-5 border-b border-border">
                <h3 className="text-base font-semibold">Usage by Feature</h3>
              </div>
              <div className="p-0">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-base-gray border-b border-border">
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Feature</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Tokens</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Cost</th>
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PLACEHOLDER_USAGE_FEATURES.map((f) => (
                      <tr key={f.name} className="border-b border-border/40 last:border-0 hover:bg-primary-50 transition-colors">
                        <td className="px-4 py-3.5 text-sm font-medium">{f.name}</td>
                        <td className="px-4 py-3.5 text-sm">{formatNumber(f.tokens)}</td>
                        <td className="px-4 py-3.5 text-sm">{f.cost}</td>
                        <td className="px-4 py-3.5 text-sm">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${f.tagColor}`}>
                            {f.percentage}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Daily Usage Trend - CSS bar chart */}
            <div className="bg-white border border-border rounded-2xl hover:shadow-md transition-all">
              <div className="flex items-center justify-between p-5 border-b border-border">
                <h3 className="text-base font-semibold">Daily Usage Trend</h3>
              </div>
              <div className="p-6">
                <div className="flex items-end gap-1.5 h-[120px] pt-5">
                  {TREND_DATA.map((height, idx) => {
                    const isHighlighted = idx >= 6 && idx <= 11;
                    return (
                      <div
                        key={idx}
                        className={`flex-1 rounded-t min-w-0 cursor-pointer transition-opacity hover:opacity-80 ${
                          isHighlighted ? "bg-primary" : "bg-primary-200"
                        }`}
                        style={{ height: `${height}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {TREND_LABELS.map((label, idx) => (
                    <span key={idx} className="flex-1 text-center text-[10px] text-muted-foreground">{label}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Usage by Document */}
          <div className="bg-white border border-border rounded-2xl hover:shadow-md transition-all">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-base font-semibold">Usage by Document</h3>
            </div>
            <div className="p-0">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-base-gray border-b border-border">
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Document</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Chapters</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Total Tokens</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Cost</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {PLACEHOLDER_USAGE_DOCS.map((d) => (
                    <tr key={d.name} className="border-b border-border/40 last:border-0 hover:bg-primary-50 transition-colors">
                      <td className="px-4 py-3.5 text-sm font-medium">{d.name}</td>
                      <td className="px-4 py-3.5 text-sm">{d.chapters}</td>
                      <td className="px-4 py-3.5 text-sm">{formatNumber(d.totalTokens)}</td>
                      <td className="px-4 py-3.5 text-sm">{d.cost}</td>
                      <td className="px-4 py-3.5 text-sm text-muted-foreground">{d.lastActivity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Raw usage entries from API (existing data) */}
          {usageEntries.length > 0 && (
            <div className="bg-white border border-border rounded-2xl mt-5 hover:shadow-md transition-all">
              <div className="flex items-center justify-between p-5 border-b border-border">
                <h3 className="text-base font-semibold">Recent API Calls</h3>
              </div>
              <div className="p-0">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-base-gray border-b border-border">
                      <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Module</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Input</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Output</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Cost</th>
                      <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageEntries.map((e) => (
                      <tr key={e.id} className="border-b border-border/40 last:border-0 hover:bg-primary-50 transition-colors">
                        <td className="px-4 py-3.5 text-sm">{e.module}</td>
                        <td className="px-4 py-3.5 text-sm text-right">{formatNumber(e.inputTokens)}</td>
                        <td className="px-4 py-3.5 text-sm text-right">{formatNumber(e.outputTokens)}</td>
                        <td className="px-4 py-3.5 text-sm text-right">{e.costEstimate != null ? `$${e.costEstimate.toFixed(4)}` : "-"}</td>
                        <td className="px-4 py-3.5 text-sm text-right text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
