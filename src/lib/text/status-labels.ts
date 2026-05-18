export const docStatusLabels: Record<string, string> = {
  uploading: "Uploading",
  converting: "Converting",
  splitting: "Splitting",
  embedding: "Embedding",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

export const docStatusColors: Record<string, string> = {
  uploading: "bg-[#EFF6FF] text-[#2563EB]",
  converting: "bg-[#FFF7ED] text-[#D97706]",
  splitting: "bg-[#FFF7ED] text-[#D97706]",
  embedding: "bg-[#EFF6FF] text-[#2563EB]",
  indexing: "bg-[#FFF7ED] text-[#D97706]",
  ready: "bg-[#DCFCE7] text-[#16A34A]",
  failed: "bg-[#FEE2E2] text-[#DC2626]",
};

export const draftStatusLabels: Record<string, string> = {
  drafting: "In Progress",
  assembling: "Assembling",
  completed: "Completed",
};

export const draftStatusColors: Record<string, string> = {
  drafting: "bg-orange-50 text-orange-600",
  assembling: "bg-blue-50 text-blue-600",
  completed: "bg-green-50 text-green-600",
};
