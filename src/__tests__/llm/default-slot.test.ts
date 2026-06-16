import { describe, expect, it } from "vitest";
import { modelMatchesDefaultSlot, type DefaultSlot } from "@/lib/llm/default-slot";

describe("modelMatchesDefaultSlot", () => {
  it("matches llm only when the model has chat/writing/llm capability", () => {
    expect(modelMatchesDefaultSlot('["chat"]', "llm")).toBe(true);
    expect(modelMatchesDefaultSlot('["writing"]', "llm")).toBe(true);
    expect(modelMatchesDefaultSlot('["llm"]', "llm")).toBe(true);
    expect(modelMatchesDefaultSlot('["embedding"]', "llm")).toBe(false);
    expect(modelMatchesDefaultSlot('["rerank"]', "llm")).toBe(false);
    expect(modelMatchesDefaultSlot('["image_generation"]', "llm")).toBe(false);
  });

  it("matches embedding only when the model has embedding/embed capability", () => {
    expect(modelMatchesDefaultSlot('["embedding"]', "embedding")).toBe(true);
    expect(modelMatchesDefaultSlot('["embed"]', "embedding")).toBe(true);
    expect(modelMatchesDefaultSlot('["chat"]', "embedding")).toBe(false);
    expect(modelMatchesDefaultSlot('["rerank"]', "embedding")).toBe(false);
  });

  it("matches rerank only when the model has rerank capability", () => {
    expect(modelMatchesDefaultSlot('["rerank"]', "rerank")).toBe(true);
    expect(modelMatchesDefaultSlot('["chat"]', "rerank")).toBe(false);
    expect(modelMatchesDefaultSlot('["embedding"]', "rerank")).toBe(false);
  });

  it("matches image only when the model has image_generation capability", () => {
    expect(modelMatchesDefaultSlot('["image_generation"]', "image")).toBe(true);
    expect(modelMatchesDefaultSlot('["image"]', "image")).toBe(true);
    expect(modelMatchesDefaultSlot('["chat"]', "image")).toBe(false);
  });

  it("regression: rerank model must NOT match llm slot (the original 'qwen3-rerank as default LLM' bug)", () => {
    expect(modelMatchesDefaultSlot('["rerank"]', "llm")).toBe(false);
  });
});

describe("DefaultSlot type domain", () => {
  it("includes all four UI slots", () => {
    const slots: DefaultSlot[] = ["llm", "embedding", "rerank", "image"];
    expect(slots).toHaveLength(4);
  });
});
