export interface DashboardDocumentStatusDisplay {
  bg: string;
  text: string;
  border: string;
  dot: string;
  label: string;
}

const docStatusDisplays: Record<string, DashboardDocumentStatusDisplay> = {
  uploaded: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-100", dot: "bg-orange-500", label: "Uploaded" },
  queued: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200", dot: "bg-slate-400", label: "Queued" },
  converting: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-100", dot: "bg-blue-500", label: "Converting" },
  indexing_graph: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-100", dot: "bg-violet-500", label: "Indexing graph" },
  converted: { bg: "bg-green-50", text: "text-green-700", border: "border-green-100", dot: "bg-green-500", label: "Converted" },
  ready: { bg: "bg-green-50", text: "text-green-700", border: "border-green-100", dot: "bg-green-500", label: "Ready" },
  indexed: { bg: "bg-green-50", text: "text-green-700", border: "border-green-100", dot: "bg-green-500", label: "Indexed" },
  failed: { bg: "bg-red-50", text: "text-red-700", border: "border-red-100", dot: "bg-red-500", label: "Failed" },
};

export function getDashboardDocumentStatusDisplay(status: string): DashboardDocumentStatusDisplay {
  return docStatusDisplays[status] ?? docStatusDisplays.uploaded;
}
