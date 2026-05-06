export type DraftStatus = "drafting" | "assembling" | "completed";

export type SectionStatus =
  | "pending"
  | "retrieving"
  | "generating"
  | "comparing"
  | "reviewing"
  | "accepted"
  | "summarized"
  | "locked"
  | "failed";

export type GenerationMode = "single" | "compare";

export type VersionSource = "generated_a" | "generated_b" | "edited" | "merged";

export interface SectionConstraints {
  referenceSections: string[];
  wordLimit: number;
  additionalRequirements: string;
  generationMode: GenerationMode;
}

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
  createdAt: string;
  updatedAt: string;
  children?: SectionMeta[];
  versions?: SectionVersionMeta[];
}

export interface SectionVersionMeta {
  id: string;
  sectionId: string;
  version: number;
  content: string;
  source: VersionSource;
  modelId: string | null;
  wordCount: number | null;
  createdAt: string;
}

export interface OutlineData {
  title: string;
  sections: {
    num: string;
    title: string;
    keyPoints?: string[];
    estimatedWords?: number;
    children?: {
      num: string;
      title: string;
      keyPoints?: string[];
      estimatedWords?: number;
    }[];
  }[];
}
