import type { OutlineSection } from "@/lib/outline-tree";

export interface BrainstormSession {
  id: string;
  title: string;
  status: string;
  outline: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

export interface BrainstormMessage {
  id: string;
  sessionId: string;
  role: "user" | "ai" | "system";
  content: string;
  createdAt: string;
}

export interface BrainstormOutline {
  title: string;
  sections: OutlineSection[];
}

export type Phase = "gathering" | "direction" | "mode_select" | "section_refine" | "ready";
