"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { getLocalizedError } from "@/lib/i18n";

export function useExport(
  id: string,
  draftTitle?: string,
) {
  const [exportFormat, setExportFormat] = useState<"markdown" | "pdf" | "docx">("markdown");

  const handleExport = useCallback(async (format?: "markdown" | "pdf" | "docx") => {
    const fmt = format || exportFormat;
    const res = await fetch(`/api/v1/drafts/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: fmt }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = fmt === "docx" ? ".docx" : fmt === "pdf" ? ".pdf" : ".md";
      a.download = `${draftTitle || "document"}${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      toast.error(getLocalizedError(data));
    }
  }, [id, draftTitle, exportFormat]);

  return { exportFormat, setExportFormat, handleExport };
}
