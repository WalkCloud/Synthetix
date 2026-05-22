export function sseEvent(type: string, data: unknown): string {
  return `data: ${JSON.stringify({ type, ...data as Record<string, unknown> })}\n\n`;
}

export function sseDone(): string {
  return `data: ${JSON.stringify({ type: "done" })}\n\n`;
}

export function sseError(message: string): string {
  return `data: ${JSON.stringify({ type: "error", error: message })}\n\n`;
}
