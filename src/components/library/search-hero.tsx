"use client";

import { Spinner } from "@/components/shared/spinner";

interface SearchHeroProps {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchMode: "keyword" | "semantic";
  setSearchMode: (v: "keyword" | "semantic") => void;
  onSearch: () => void;
  isSearching: boolean;
}

export function SearchHero({
  searchQuery,
  setSearchQuery,
  searchMode,
  setSearchMode,
  onSearch,
  isSearching,
}: SearchHeroProps) {
  return (
    <div
      className="rounded-[22px] border border-border p-8 mb-6 animate-fade-in-up bg-gradient-to-br from-violet-50 via-amber-50/50 to-white dark:from-violet-950/40 dark:via-transparent dark:to-transparent"
    >
      <h3 className="font-display text-[20px] font-bold text-foreground mb-1">
        Search Your Knowledge Base
      </h3>
      <p className="text-[14px] text-muted-foreground mb-5">
        Find documents by keyword or ask questions with AI-powered semantic search
      </p>
      <div className="flex bg-card rounded-[16px] shadow-md border-2 border-border focus-within:border-primary transition-colors">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-5 h-5 ml-4 my-auto text-muted-foreground shrink-0"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search documents or ask a question..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          className="flex-1 border-none px-4 py-4 text-[15px] outline-none bg-transparent font-sans text-foreground placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-0.5 p-1.5 bg-muted rounded-[12px] my-1.5 mr-1.5">
          <button
            onClick={() => setSearchMode("keyword")}
            className={`px-3.5 py-2 rounded-[10px] text-xs font-semibold transition-all ${searchMode === "keyword" ? "bg-card text-primary shadow-sm" : "bg-transparent text-muted-foreground"}`}
          >
            Keyword
          </button>
          <button
            onClick={() => setSearchMode("semantic")}
            className={`px-3.5 py-2 rounded-[10px] text-xs font-semibold transition-all ${searchMode === "semantic" ? "bg-card text-primary shadow-sm" : "bg-transparent text-muted-foreground"}`}
          >
            Semantic
          </button>
        </div>
        <button
          onClick={onSearch}
          disabled={isSearching}
          className="btn m-1.5 px-6 py-3 bg-primary text-white font-semibold rounded-[12px] hover:bg-primary-light transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[90px]"
        >
          {isSearching ? <Spinner size="sm" className="text-white" /> : "Search"}
        </button>
      </div>
    </div>
  );
}
