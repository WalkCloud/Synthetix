import type { ModelOption } from "@/types/writing";

/**
 * Default-slot markers carried by ModelConfig.isDefaultFor. "llm" is the
 * scoped default for chat/writing; "default" is the legacy catch-all slot.
 * Both resolve to the same model in resolve-model.ts, so we treat either as
 * "this model is the user's default chat model". See resolve-model.ts.
 */
const DEFAULT_CHAT_SLOTS = new Set(["llm", "default"]);

/** Whether a model option is flagged as the user's default chat model. */
export function isDefaultChatModel(model: ModelOption): boolean {
  return !!model.isDefaultFor && DEFAULT_CHAT_SLOTS.has(model.isDefaultFor);
}

/** The user's default chat model, or null if none is flagged. */
export function findDefaultChatModel(models: ModelOption[]): ModelOption | null {
  return models.find(isDefaultChatModel) ?? null;
}

/**
 * The first chat model that is NOT the default — used as the initial pick for
 * Model B in compare mode. Falls back to the first available model (even the
 * default) when only one model exists so the selector still has a value.
 */
export function findFirstNonDefault(
  models: ModelOption[],
  excludeId?: string,
): ModelOption | null {
  const fallback = excludeId ? models.find((m) => m.id !== excludeId) : null;
  const nonDefault = models.find((m) => !isDefaultChatModel(m) && m.id !== excludeId);
  return nonDefault ?? fallback ?? models[0] ?? null;
}
