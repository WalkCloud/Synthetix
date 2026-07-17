/**
 * Shared SSE event schema for all writing generation routes.
 * Every SSE event MUST use one of these types so the client reducer can
 * handle them uniformly without route-specific parsing.
 */
export type SSEEventType =
  | "references"
  | "chunk"
  | "reasoning"
  | "contentA"
  | "contentB"
  | "done"
  | "error"
  | "assets"
  | "progress"
  | "tokenUsage"
  | "status"
  | "summary"
  | "complete"
  | "model_error";

export interface SSEEvent {
  type: SSEEventType;
  [key: string]: unknown;
}

export function sseEvent(type: SSEEventType, data: unknown): string {
  return `data: ${JSON.stringify({ type, ...data as Record<string, unknown> })}\n\n`;
}

export function sseDone(): string {
  return `data: ${JSON.stringify({ type: "done" })}\n\n`;
}

export function sseError(message: string): string {
  return `data: ${JSON.stringify({ type: "error", error: message })}\n\n`;
}

/** Parse an SSE data line back into a typed event (for client-side reducers). */
export function parseSSEEvent(line: string): SSEEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6).trim()) as SSEEvent;
  } catch {
    return null;
  }
}
