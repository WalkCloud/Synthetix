import { parseCapabilities } from "./capabilities";

/**
 * The set of "default model" slots that the user can pick on the Models page.
 * Mirror of the frontend `Tab` enum minus `usage`. Adding a new slot here is
 * a contract change — update the route, the UI, and migrate existing rows.
 */
export type DefaultSlot = "llm" | "embedding" | "rerank" | "image";

/**
 * Returns true iff the model's declared capabilities permit it to fill the given
 * default slot. The earlier implementation defined "matches llm" as the *negation*
 * of "is embedding/image", which silently accepted rerank-only models as LLM
 * defaults — that's how `qwen3-rerank` ended up labeled `isDefaultFor="llm"`.
 *
 * Each slot now has an explicit allow-list:
 *   llm       ← chat | writing | llm
 *   embedding ← embedding | embed
 *   rerank    ← rerank
 *   image     ← image_generation | image
 */
export function modelMatchesDefaultSlot(
  rawCapabilities: unknown,
  slot: DefaultSlot,
): boolean {
  const caps = parseCapabilities(rawCapabilities);
  switch (slot) {
    case "llm":
      return caps.some((c) => c === "chat" || c === "writing" || c === "llm");
    case "embedding":
      return caps.some((c) => c === "embedding" || c === "embed");
    case "rerank":
      return caps.includes("rerank");
    case "image":
      return caps.some((c) => c === "image_generation" || c === "image");
  }
}

export function normalizeDefaultSlot(value: unknown): DefaultSlot | null {
  return value === "embedding" || value === "image" || value === "llm" || value === "rerank"
    ? value
    : null;
}
