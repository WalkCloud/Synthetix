export function taskMatchesSession(inputData: string | null, sessionId: string): boolean {
  if (!inputData) return false;

  try {
    const parsed = JSON.parse(inputData) as { sessionId?: unknown };
    return parsed.sessionId === sessionId;
  } catch {
    return false;
  }
}
