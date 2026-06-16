export function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "";
}

const FILE_ICON_MAP: Record<string, string> = {
  pdf: "bg-red-100 text-red-700 dark:bg-red-950/35 dark:text-red-300",
  docx: "bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300",
  doc: "bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300",
  xlsx: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
  xls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
  pptx: "bg-orange-100 text-orange-700 dark:bg-orange-950/35 dark:text-orange-300",
  ppt: "bg-orange-100 text-orange-700 dark:bg-orange-950/35 dark:text-orange-300",
  md: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
  html: "bg-orange-100 text-orange-700 dark:bg-orange-950/35 dark:text-orange-300",
  epub: "bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300",
  txt: "bg-muted text-muted-foreground",
};

export function getFileIconClass(extOrName: string): string {
  const ext = extOrName.includes(".") ? getFileExt(extOrName) : extOrName;
  return FILE_ICON_MAP[ext] || "bg-muted text-muted-foreground";
}

export function getFileTypeLabel(extOrName: string): string {
  const ext = extOrName.includes(".") ? getFileExt(extOrName) : extOrName;
  const labels: Record<string, string> = {
    pdf: "PDF", docx: "Word", doc: "Word", xlsx: "Excel", xls: "Excel",
    pptx: "PowerPoint", ppt: "PowerPoint", md: "Markdown",
    html: "HTML", epub: "EPUB", txt: "Text",
  };
  return labels[ext] || ext.toUpperCase();
}
