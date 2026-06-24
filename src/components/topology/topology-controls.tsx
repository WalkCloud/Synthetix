"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/lib/i18n";

interface TopologyControlsProps {
  readonly mode: "documents" | "knowledge";
  readonly drafts?: readonly { id: string; title: string }[];
  readonly selectedDraftId?: string | null;
  readonly onDraftChange?: (id: string) => void;
  readonly zoom: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomFit: () => void;
  readonly kgSearch?: string;
  readonly onKgSearchChange?: (val: string) => void;
  readonly onKgSearchSubmit?: (entityName?: string) => void;
  readonly kgCenter?: string;
  readonly onKgCenterClear?: () => void;
  readonly totalEntities?: number;
  readonly totalRelations?: number;
  readonly leafCount?: number;
}

const BAR_H = "h-8";

export function TopologyControls({
  mode,
  drafts,
  selectedDraftId,
  onDraftChange,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  kgSearch,
  onKgSearchChange,
  onKgSearchSubmit,
  kgCenter,
  onKgCenterClear,
  totalEntities,
  totalRelations,
  leafCount,
}: TopologyControlsProps) {
  const { t } = useLocale();
  const c = t.topology.controls;
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allEntitiesRef = useRef<string[]>([]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q || q.length < 1) { setSuggestions([]); setShowDropdown(false); return; }
    try {
      if (allEntitiesRef.current.length === 0) {
        const res = await fetch("/api/v1/knowledge/entities?limit=500");
        const d = await res.json();
        if (d.success && Array.isArray(d.data?.entities)) {
          allEntitiesRef.current = d.data.entities;
        }
      }
      const lower = q.toLowerCase();
      const filtered = allEntitiesRef.current.filter(e => e.toLowerCase().includes(lower)).slice(0, 8);
      setSuggestions(filtered);
      setShowDropdown(filtered.length > 0);
    } catch {
      setSuggestions([]);
      setShowDropdown(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== "knowledge") return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mode]);

  function handleInputChange(val: string) {
    onKgSearchChange?.(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  }

  function handleSelectSuggestion(name: string) {
    setShowDropdown(false);
    setSuggestions([]);
    onKgSearchChange?.(name);
    onKgSearchSubmit?.(name);
  }

  return (
    <div className="flex items-center gap-2.5 mb-4 flex-wrap h-8">
      {mode === "documents" && drafts && onDraftChange && (
        <Select value={selectedDraftId ?? ""} onValueChange={(v) => onDraftChange(v!)}>
          <SelectTrigger size="sm" className="w-[280px] text-[13px] bg-card cursor-pointer">
            <SelectValue placeholder={c.selectDraft}>
              {(v: string | null) => drafts.find(d => d.id === v)?.title ?? c.selectDraft}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {drafts.map((draft) => (
              <SelectItem key={draft.id} value={draft.id}>{draft.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {mode === "knowledge" && (
        <div className={`relative ${BAR_H}`}>
          <div className="relative h-full">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              value={kgSearch ?? ""}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && kgSearch?.trim()) {
                  setShowDropdown(false);
                  onKgSearchSubmit?.(kgSearch);
                }
                if (e.key === "Escape") setShowDropdown(false);
              }}
              onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder={c.searchEntity}
              className="w-[200px] h-full pl-7 pr-2 border border-border rounded-lg text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          {showDropdown && suggestions.length > 0 && (
            <div ref={dropdownRef} className="absolute top-full left-0 mt-1 w-[200px] bg-card border border-border rounded-lg shadow-lg z-50 max-h-[200px] overflow-y-auto">
              {suggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-[12px] text-foreground hover:bg-secondary truncate cursor-pointer"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectSuggestion(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "knowledge" && kgCenter && (
        <div className={`inline-flex max-w-[320px] items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 text-[12px] font-medium text-primary ${BAR_H}`}>
          <span className="shrink-0">{c.focused}:</span>
          <span className="truncate">{kgCenter}</span>
          <button
            type="button"
            onClick={onKgCenterClear}
            className="ml-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-primary/80 transition hover:bg-primary/15 hover:text-primary"
            aria-label={c.backToCoreGraph}
            title={c.backToCoreGraph}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {mode === "knowledge" && totalEntities !== undefined && totalRelations !== undefined && (
        <span className="text-[13px] text-muted-foreground">
          {totalEntities} {c.entities} &middot; {totalRelations} {c.relations}
          {leafCount !== undefined && leafCount > 0 && <span className="ml-2">({leafCount} {c.hidden})</span>}
        </span>
      )}

      <div className={`flex items-center gap-0.5 border border-border rounded-lg p-0.5 ${BAR_H}`}>
        <button type="button" onClick={onZoomIn} className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer" aria-label={c.zoomIn} title={c.zoomIn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button type="button" onClick={onZoomOut} className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer" aria-label={c.zoomOut} title={c.zoomOut}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button type="button" onClick={onZoomFit} className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer" aria-label={c.fitToScreen} title={c.fitToScreen}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
