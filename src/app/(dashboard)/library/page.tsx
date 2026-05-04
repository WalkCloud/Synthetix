"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { SearchBar } from "@/components/library/search-bar";
import { DocumentList } from "@/components/library/document-list";
import type { DocumentMeta } from "@/types/documents";

export default function LibraryPage() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const fetchDocuments = useCallback(async (p: number) => {
    setLoading(true);
    const res = await fetch(`/api/v1/library/documents?page=${p}&limit=${limit}`);
    const data = await res.json();
    if (data.success) {
      setDocuments(data.data);
      setTotal(data.total);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDocuments(page); }, [page, fetchDocuments]);

  const handleSearch = useCallback(async (query: string, mode: "keyword" | "semantic") => {
    setLoading(true);
    const endpoint = mode === "keyword" ? "/api/v1/library/search/keyword" : "/api/v1/library/search/semantic";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (data.success) {
      setDocuments(data.data.map((r: Record<string, unknown>) => ({
        id: (r.documentId || r.chunkId || "") as string,
        originalName: (r.documentName || r.title || "Unknown") as string,
        originalFormat: "",
        originalSize: 0,
        originalHash: null,
        status: "ready" as const,
        parentId: null,
        tokenEstimate: null,
        wordCount: null,
        createdAt: "",
        updatedAt: "",
        tags: [],
      })));
      setTotal(data.data.length);
    }
    setLoading(false);
  }, []);

  return (
    <div>
      <Header title="Document Library" />
      <div className="p-8">
        <div className="mb-6">
          <SearchBar onSearch={handleSearch} />
        </div>
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Loading...</div>
        ) : (
          <DocumentList documents={documents} total={total} page={page} limit={limit} onPageChange={setPage} />
        )}
      </div>
    </div>
  );
}
