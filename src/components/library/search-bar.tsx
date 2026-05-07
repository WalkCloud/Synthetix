"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SearchBarProps {
  onSearch: (query: string, mode: "keyword" | "semantic") => void;
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); query && onSearch(query, mode); }}
      className="flex gap-2"
    >
      <div className="flex-1 relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder={mode === "keyword" ? "Search by keyword..." : "Search by meaning..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Select value={mode} onValueChange={(v) => setMode(v as "keyword" | "semantic")}>
        <SelectTrigger className="text-sm w-[130px]">
          <SelectValue>{(v: string | null) => v === 'semantic' ? 'Semantic' : 'Keyword'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="keyword">Keyword</SelectItem>
          <SelectItem value="semantic">Semantic</SelectItem>
        </SelectContent>
      </Select>
      <button
        type="submit"
        className="px-5 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light text-sm"
      >
        Search
      </button>
    </form>
  );
}
