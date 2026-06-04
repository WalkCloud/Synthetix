import { semanticSearch } from "@/lib/search/semantic";

export async function preFetchDomainKnowledge(userMessage: string, userId: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const results = await Promise.race([
      semanticSearch(userMessage, userId, 5),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("timeout")))
      ),
    ]);
    clearTimeout(timeout);
    if (!results || results.length === 0) return null;
    return results
      .map((r: { content: string }, i: number) => `[${i + 1}] ${r.content.slice(0, 500)}`)
      .join("\n\n");
  } catch {
    return null;
  }
}
