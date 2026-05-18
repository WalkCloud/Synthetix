export function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "";
}

const FILE_ICON_MAP: Record<string, string> = {
  pdf: "bg-[#FEE2E2] text-[#DC2626]",
  docx: "bg-[#EFF6FF] text-[#2563EB]",
  doc: "bg-[#EFF6FF] text-[#2563EB]",
  xlsx: "bg-[#DCFCE7] text-[#16A34A]",
  xls: "bg-[#DCFCE7] text-[#16A34A]",
  pptx: "bg-[#FFF7ED] text-[#EA580C]",
  ppt: "bg-[#FFF7ED] text-[#EA580C]",
  md: "bg-[#DCFCE7] text-[#16A34A]",
  html: "bg-[#FFF7ED] text-[#EA580C]",
  epub: "bg-[#EFF6FF] text-[#2563EB]",
  txt: "bg-[#F4F2EF] text-[#6B6560]",
};

export function getFileIconClass(extOrName: string): string {
  const ext = extOrName.includes(".") ? getFileExt(extOrName) : extOrName;
  return FILE_ICON_MAP[ext] || "bg-[#F4F2EF] text-[#6B6560]";
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
