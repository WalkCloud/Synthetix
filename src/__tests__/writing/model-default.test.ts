import { describe, it, expect } from "vitest";
import type { ModelOption } from "@/types/writing";
import { isDefaultChatModel, findDefaultChatModel, findFirstNonDefault } from "@/lib/writing/model-default";

function model(id: string, isDefaultFor?: string | null): ModelOption {
  return { id, modelName: id, capabilities: "[]", isDefaultFor: isDefaultFor ?? null };
}

describe("isDefaultChatModel", () => {
  it('treats isDefaultFor="llm" as the default chat model', () => {
    expect(isDefaultChatModel(model("a", "llm"))).toBe(true);
  });

  it('treats isDefaultFor="default" (legacy slot) as default', () => {
    expect(isDefaultChatModel(model("a", "default"))).toBe(true);
  });

  it("does not treat embedding/rerank/image slots as chat default", () => {
    expect(isDefaultChatModel(model("a", "embedding"))).toBe(false);
    expect(isDefaultChatModel(model("a", "rerank"))).toBe(false);
  });

  it("returns false when no slot is set", () => {
    expect(isDefaultChatModel(model("a"))).toBe(false);
  });
});

describe("findDefaultChatModel", () => {
  it("returns the model flagged as default", () => {
    const models = [model("a"), model("b", "llm"), model("c")];
    expect(findDefaultChatModel(models)?.id).toBe("b");
  });

  it("returns null when no model is flagged", () => {
    const models = [model("a"), model("b")];
    expect(findDefaultChatModel(models)).toBeNull();
  });
});

describe("findFirstNonDefault", () => {
  it("returns the first non-default model excluding the given id", () => {
    const models = [model("a", "llm"), model("b"), model("c")];
    expect(findFirstNonDefault(models, "a")?.id).toBe("b");
  });

  it("skips the excluded id even among non-defaults", () => {
    const models = [model("a", "llm"), model("b"), model("c")];
    expect(findFirstNonDefault(models, "b")?.id).toBe("c");
  });

  it("falls back to the first available model when only the default remains", () => {
    const models = [model("a", "llm")];
    expect(findFirstNonDefault(models, "a")?.id).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(findFirstNonDefault([], "a")).toBeNull();
  });
});
