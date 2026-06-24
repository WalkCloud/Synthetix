import type { DraftStatus, SectionStatus } from "@/lib/writing/status";

export {
  CONFIRMED_SECTION_STATUSES,
  deriveDraftStatus,
  isSectionDone,
} from "@/lib/writing/status";
export type { DraftStatus, SectionStatus } from "@/lib/writing/status";

export type GenerationMode = "single" | "compare";

export interface ModelOption {
  id: string;
  modelName: string;
  capabilities: string;
}

export type VersionSource = "generated_a" | "generated_b" | "edited";

export interface DraftProgress {
  accepted: number;
  completed: number;
  total: number;
  wordsWritten: number;
  wordsEstimated: number;
}

export interface DraftMeta {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  outline: string;
  status: DraftStatus;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  sections?: SectionMeta[];
  progress?: DraftProgress;
}

interface SectionReferenceMeta {
  documentName: string;
  relevanceScore: number;
  sourceAnchor: string | null;
  documentId: string | null;
  chunkId?: string | null;
  content: string | null;
  sourceType?: string | null;
  images?: Array<{ documentId: string; filename: string; url: string; altText: string | null }>;
}

export interface SectionMeta {
  id: string;
  draftId: string;
  parentId: string | null;
  index: number;
  title: string;
  description: string | null;
  keyPoints: string | null;
  estimatedWords: number | null;
  status: SectionStatus;
  content: string | null;
  summary: string | null;
  wordCount: number | null;
  constraints: string | null;
  contentA: string | null;
  contentB: string | null;
  modelA: string | null;
  modelB: string | null;
  selectedModel: string | null;
  ragMode: string;
  ragDocumentIds: string | null;
  createdAt: string;
  updatedAt: string;
  children?: SectionMeta[];
  versions?: SectionVersionMeta[];
  references?: SectionReferenceMeta[];
}

interface SectionVersionMeta {
  id: string;
  sectionId: string;
  version: number;
  content: string;
  source: VersionSource;
  modelId: string | null;
  wordCount: number | null;
  createdAt: string;
}

export interface OutlineSectionData {
  num: string;
  title: string;
  description?: string;
  keyPoints?: string[];
  estimatedWords?: number;
  writingRequirements?: string;
  retrievalQuery?: string;
  referenceHints?: string[];
  children?: OutlineSectionData[];
}

export interface OutlineData {
  title: string;
  sections: OutlineSectionData[];
}
