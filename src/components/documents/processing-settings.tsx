"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ModelOption {
  id: string;
  modelName: string;
  providerName: string;
  embeddingDim?: number | null;
  isDefaultFor?: string | null;
}

export function modelLabel(models: ModelOption[], id: string): string {
  const m = models.find((x) => x.id === id);
  return m ? `${m.modelName} (${m.providerName})` : "Select...";
}

const SPLIT_LABELS: Record<string, string> = {
  "structure-llm": "Structure first + LLM semantic review (Recommended)",
  "heading-only": "Heading and page boundaries only",
};

const INDEX_LABELS: Record<string, string> = {
  full: "Original + chunks + LightRAG graph (Recommended)",
  original: "Original Markdown only",
  chunks: "Chunks only",
};

const GRAPH_LABELS: Record<string, string> = {
  basic: "Chunk storage only (fast)",
  graph: "Entity extraction + knowledge graph (Recommended)",
};

export { SPLIT_LABELS, INDEX_LABELS, GRAPH_LABELS };
export type { ModelOption };

interface ProcessingSettingsProps {
  llmModels: ModelOption[];
  embedModels: ModelOption[];
  llmModel: string;
  embedModel: string;
  contextUsage: number;
  splitStrategy: string;
  indexTarget: string;
  indexMode: "basic" | "graph";
  autoSplit: boolean;
  onLlmModelChange: (v: string) => void;
  onEmbedModelChange: (v: string) => void;
  onContextUsageChange: (v: number) => void;
  onSplitStrategyChange: (v: string) => void;
  onIndexTargetChange: (v: string) => void;
  onIndexModeChange: (v: "basic" | "graph") => void;
  onAutoSplitChange: (v: boolean) => void;
}

export function ProcessingSettings({
  llmModels, embedModels, llmModel, embedModel,
  contextUsage, splitStrategy, indexTarget, indexMode, autoSplit,
  onLlmModelChange, onEmbedModelChange, onContextUsageChange,
  onSplitStrategyChange, onIndexTargetChange, onIndexModeChange, onAutoSplitChange,
}: ProcessingSettingsProps) {
  return (
    <div className="bg-card border border-border rounded-[16px] shadow-sm mb-6 animate-fade-in-up">
      <div className="flex items-center justify-between px-6 py-5 border-b border-border">
        <h3 className="font-display text-[16px] font-semibold text-foreground">Processing Settings</h3>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">LLM Model</label>
            <Select value={llmModel} onValueChange={(v) => onLlmModelChange(v!)}>
              <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                <SelectValue>{modelLabel(llmModels, llmModel)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {llmModels.length === 0 ? (
                  <SelectItem value="none" disabled>No models configured — add in Model Management</SelectItem>
                ) : (
                  llmModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.modelName} ({m.providerName})</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Embedding Model</label>
            <Select value={embedModel} onValueChange={(v) => onEmbedModelChange(v!)}>
              <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                <SelectValue>{modelLabel(embedModels, embedModel)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {embedModels.length === 0 ? (
                  <SelectItem value="none" disabled>No embedding models configured</SelectItem>
                ) : (
                  embedModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.modelName} ({m.providerName})</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Max Context Usage</label>
            <div className="flex items-center gap-3">
              <input type="range" min="10" max="100" value={contextUsage}
                className="flex-1 h-2 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                onChange={(e) => onContextUsageChange(Number(e.target.value))} />
              <span className="text-[14px] font-semibold text-primary min-w-[36px] text-right">{contextUsage}%</span>
            </div>
            <p className="text-[12px] text-muted-foreground mt-1">Token-based safety threshold. Prompt, references, and output budget remain reserved.</p>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Split Strategy</label>
            <Select value={splitStrategy} onValueChange={(v) => onSplitStrategyChange(v!)}>
              <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                <SelectValue>{SPLIT_LABELS[splitStrategy] ?? splitStrategy}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="structure-llm">{SPLIT_LABELS["structure-llm"]}</SelectItem>
                <SelectItem value="heading-only">{SPLIT_LABELS["heading-only"]}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground mt-1">Uses headings, pages, tables, and then domain/topic correlation.</p>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Index Target</label>
            <Select value={indexTarget} onValueChange={(v) => onIndexTargetChange(v!)}>
              <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                <SelectValue>{INDEX_LABELS[indexTarget] ?? indexTarget}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{INDEX_LABELS.full}</SelectItem>
                <SelectItem value="original">{INDEX_LABELS.original}</SelectItem>
                <SelectItem value="chunks">{INDEX_LABELS.chunks}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground mt-1">Stores provenance for source file, page, heading path, block, and image assets.</p>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Knowledge Graph</label>
            {(() => {
              const selectedEmbed = embedModels.find(m => m.id === embedModel);
              const dim = selectedEmbed?.embeddingDim ?? 0;
              const probed = dim > 0;
              const lightragCompatible = dim >= 1536;
                if (!selectedEmbed || !embedModel) {
                return (
                  <Select value="basic" onValueChange={() => {}}>
                    <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm opacity-60">
                      <SelectValue>{GRAPH_LABELS.basic}</SelectValue>
                    </SelectTrigger>
                  </Select>
                );
              }
              return (
                <>
                  <Select value={indexMode} onValueChange={(v) => onIndexModeChange(v as "basic" | "graph")}>
                    <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                      <SelectValue>{GRAPH_LABELS[indexMode]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">{GRAPH_LABELS.basic}</SelectItem>
                      <SelectItem value="graph" disabled={!probed || !lightragCompatible}>
                        {GRAPH_LABELS.graph}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {!probed && (
                    <p className="text-[12px] text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 mt-2">
                      Embedding dimension not verified. Test Connection in Model Management first.
                    </p>
                  )}
                  {probed && !lightragCompatible && (
                    <p className="text-[12px] text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 mt-2">
                      Current model dimension ({dim}) is below the 1536 minimum required for knowledge graph extraction. Use a higher-dimension embedding model.
                    </p>
                  )}
                  {probed && lightragCompatible && (
                    <p className="text-[12px] text-muted-foreground mt-1">Graph mode extracts entities and relations for enhanced retrieval and topology.</p>
                  )}
                </>
              );
            })()}
          </div>
          <div className="col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-0.5">Auto-split and preserve provenance</label>
                <p className="text-[12px] text-muted-foreground">Chunks documents over the token threshold and keeps source anchors for RAG/topology.</p>
              </div>
              <label className="relative w-11 h-6 cursor-pointer">
                <input type="checkbox" checked={autoSplit} onChange={(e) => onAutoSplitChange(e.target.checked)} className="sr-only peer"/>
                <span className="absolute inset-0 bg-muted rounded-full transition-all duration-200 peer-checked:bg-primary after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-[18px] after:h-[18px] after:bg-card after:rounded-full after:transition-transform after:duration-200 peer-checked:after:translate-x-5"/>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
