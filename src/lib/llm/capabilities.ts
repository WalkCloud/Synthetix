export function parseCapabilities(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((c): c is string => typeof c === "string");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((c): c is string => typeof c === "string");
    }
    return [];
  } catch {
    return [];
  }
}

export function hasCapability(raw: unknown, capability: string): boolean {
  return parseCapabilities(raw).includes(capability);
}
