"use client";

import { useState, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { UploadZone } from "@/components/documents/upload-zone";
import { UploadProgress } from "@/components/documents/upload-progress";
import type { UploadItem } from "@/components/documents/upload-progress";

export default function DocumentsPage() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const item: UploadItem = { name: file.name, size: file.size, status: "uploading", progress: 0 };
      setUploads((prev) => [...prev, item]);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/v1/documents/upload", { method: "POST", body: formData });
        const data = await res.json();

        if (data.success) {
          setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "ready", progress: 100, docId: data.data.document.id } : u));
        } else if (data.error === "DUPLICATE") {
          setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "ready", progress: 100, docId: data.data.existingId } : u));
        } else {
          setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "failed", error: data.error } : u));
        }
      } catch {
        setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "failed", error: "Upload failed" } : u));
      }
    }
  }, []);

  return (
    <div>
      <Header title="Document Init" />
      <div className="p-8 max-w-3xl">
        <div className="mb-6">
          <h2 className="text-lg font-bold mb-1">Upload Documents</h2>
          <p className="text-sm text-muted-foreground">
            Upload reference materials to convert them into searchable Markdown.
          </p>
        </div>
        <UploadZone onUpload={handleUpload} />
        <UploadProgress items={uploads} />
      </div>
    </div>
  );
}
