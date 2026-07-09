import { describe, expect, it } from "vitest";
import { getDashboardDocumentStatusDisplay } from "@/lib/dashboard/document-status";

const labels = {
  ready: "Ready",
  enhancing: "Enhancing",
  processing: "Processing",
  failed: "Failed",
  pending: "Pending",
};

describe("getDashboardDocumentStatusDisplay", () => {
  it("maps the ready display status to the supplied Ready label", () => {
    expect(getDashboardDocumentStatusDisplay("ready", labels).label).toBe("Ready");
  });

  it("maps the failed display status to the supplied Failed label", () => {
    expect(getDashboardDocumentStatusDisplay("failed", labels).label).toBe("Failed");
  });

  it("maps processing and enhancing display statuses", () => {
    expect(getDashboardDocumentStatusDisplay("processing", labels).label).toBe("Processing");
    expect(getDashboardDocumentStatusDisplay("enhancing", labels).label).toBe("Enhancing");
  });

  it("maps the pending display status", () => {
    expect(getDashboardDocumentStatusDisplay("pending", labels).label).toBe("Pending");
  });

  it("falls back to processing styling for unknown status values", () => {
    // Legacy/stale raw DB statuses (e.g. "converting", "indexing_graph") are no
    // longer valid keys — the dashboard now reads the task-driven displayStatus.
    // Such an input should fall back to "processing", not raise.
    const sc = getDashboardDocumentStatusDisplay("indexing_graph", labels);
    expect(sc.label).toBe("Processing");
    expect(sc.bg).toBe(getDashboardDocumentStatusDisplay("processing", labels).bg);
  });

  it("uses the caller-supplied labels (i18n) rather than hardcoded English", () => {
    const zh = {
      ready: "就绪",
      enhancing: "已就绪 · 增强中",
      processing: "处理中",
      failed: "失败",
      pending: "待处理",
    };
    expect(getDashboardDocumentStatusDisplay("ready", zh).label).toBe("就绪");
    expect(getDashboardDocumentStatusDisplay("failed", zh).label).toBe("失败");
  });
});
