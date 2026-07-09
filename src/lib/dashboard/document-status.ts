/**
 * Dashboard "Recent Documents" status-badge styling + label mapping.
 *
 * IMPORTANT: this maps the 5-value task-driven `DocumentDisplayStatus`
 * (ready | enhancing | processing | failed | pending) — the SAME source the
 * library list and detail page use — NOT the coarse raw `Document.status`
 * column. The dashboard API now computes `displayStatus` via
 * `annotateDocumentsWithDisplayStatus`, so all three surfaces stay in sync.
 *
 * Labels are passed in from the caller (already localized via i18n) so this
 * module stays free of hardcoded English — see the matching fix for the old
 * behavior where the dashboard showed "Ready"/"Failed" regardless of the
 * selected language.
 */
import type { DocumentDisplayStatus } from "@/lib/documents/pipeline-stages";

export interface DashboardDocumentStatusDisplay {
  bg: string;
  text: string;
  border: string;
  dot: string;
}

/** Localized label set the caller must supply (one per display status). */
export interface DashboardDocumentStatusLabels {
  ready: string;
  enhancing: string;
  processing: string;
  failed: string;
  pending: string;
}

const docStatusDisplays: Record<DocumentDisplayStatus, DashboardDocumentStatusDisplay> = {
  ready: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100", dot: "bg-emerald-500" },
  enhancing: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-100", dot: "bg-sky-500" },
  processing: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-100", dot: "bg-sky-500" },
  failed: { bg: "bg-red-50", text: "text-red-700", border: "border-red-100", dot: "bg-red-500" },
  pending: { bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200", dot: "bg-slate-400" },
};

/**
 * @param displayStatus The task-driven display status from the API. Anything not
 *                       in the known set falls back to "processing" styling.
 * @param labels         Localized labels (one per display status).
 * @returns styling + the localized label to render.
 */
export function getDashboardDocumentStatusDisplay(
  displayStatus: string,
  labels: DashboardDocumentStatusLabels,
): DashboardDocumentStatusDisplay & { label: string } {
  const key = (Object.prototype.hasOwnProperty.call(docStatusDisplays, displayStatus)
    ? displayStatus
    : "processing") as DocumentDisplayStatus;
  return { ...docStatusDisplays[key], label: labels[key] };
}
