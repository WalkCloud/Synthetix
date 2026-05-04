"use client";

import { useState, useEffect, use } from "react";
import { Header } from "@/components/layout/header";
import { TagBadge } from "@/components/library/tag-badge";
import type { DocumentMeta } from "@/types/documents";

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [doc, setDoc] = useState<DocumentMeta | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [docRes, contentRes] = await Promise.all([
        fetch(`/api/v1/library/documents/${id}`),
        fetch(`/api/v1/library/documents/${id}/content`),
      ]);
      const docData = await docRes.json();
      const contentData = await contentRes.json();
      if (docData.success) setDoc(docData.data);
      if (contentData.success) setContent(contentData.data.content);
      setLoading(false);
    }
    load();
  }, [id]);

  async function addTag(name: string) {
    await fetch(`/api/v1/library/documents/${id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const res = await fetch(`/api/v1/library/documents/${id}`);
    const data = await res.json();
    if (data.success) setDoc(data.data);
  }

  async function removeTag(name: string) {
    await fetch(`/api/v1/library/documents/${id}/tags/${name}`, { method: "DELETE" });
    const res = await fetch(`/api/v1/library/documents/${id}`);
    const data = await res.json();
    if (data.success) setDoc(data.data);
  }

  if (loading) return <div><Header title="Loading..." /><div className="p-8">Loading...</div></div>;
  if (!doc) return <div><Header title="Not Found" /><div className="p-8">Document not found.</div></div>;

  return (
    <div>
      <Header title={doc.originalName} />
      <div className="p-8 grid grid-cols-[1fr_300px] gap-6">
        <div className="bg-white border rounded-[16px] p-6">
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap font-sans text-sm">{content || "Content not yet available."}</pre>
          </div>
        </div>
        <aside className="space-y-4">
          <div className="bg-white border rounded-[16px] p-5">
            <h3 className="font-semibold mb-3">Document Info</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Format</dt><dd className="font-medium uppercase">{doc.originalFormat}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Size</dt><dd className="font-medium">{(doc.originalSize / 1024).toFixed(0)} KB</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{doc.status}</dd></div>
              {doc.wordCount && <div className="flex justify-between"><dt className="text-muted-foreground">Words</dt><dd className="font-medium">{doc.wordCount}</dd></div>}
              {doc.tokenEstimate && <div className="flex justify-between"><dt className="text-muted-foreground">Tokens</dt><dd className="font-medium">{doc.tokenEstimate}</dd></div>}
            </dl>
          </div>
          <div className="bg-white border rounded-[16px] p-5">
            <h3 className="font-semibold mb-3">Tags</h3>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {doc.tags?.map((tag) => <TagBadge key={tag.id} name={tag.name} onRemove={removeTag} />)}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); const input = (e.target as HTMLFormElement).tag as HTMLInputElement; if (input.value) { addTag(input.value); input.value = ""; } }} className="flex gap-2">
              <input name="tag" className="flex-1 px-3 py-1.5 border rounded-lg text-sm" placeholder="Add tag..." />
              <button type="submit" className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-medium">Add</button>
            </form>
          </div>
          {doc.chunks && doc.chunks.length > 0 && (
            <div className="bg-white border rounded-[16px] p-5">
              <h3 className="font-semibold mb-3">Chunks ({doc.chunks.length})</h3>
              <ul className="space-y-2 text-sm">
                {doc.chunks.map((chunk) => (
                  <li key={chunk.id} className="flex justify-between text-muted-foreground">
                    <span className="truncate">{chunk.title || `Chunk ${chunk.index + 1}`}</span>
                    {chunk.tokenCount && <span className="shrink-0">{chunk.tokenCount} tokens</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
