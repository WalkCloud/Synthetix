import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm/factory", () => ({
  createLLMProvider: (provider: unknown) => ({ provider }),
}));

import { db } from "@/lib/db";
import { invalidateResolveModelCache } from "@/lib/llm/resolve-model";
import { resolveModelOrFallback } from "@/lib/writing/resolve-models";
import * as generatorModule from "@/lib/writing/generator";
import * as outlineWorkerModule from "@/lib/queue/workers/outline-worker";

const OWNER_ID = "test-model-ownership-owner";
const OTHER_USER_ID = "test-model-ownership-other";
const OWNER_PROVIDER_ID = "test-model-ownership-owner-provider";
const OTHER_PROVIDER_ID = "test-model-ownership-other-provider";
const OWNER_CONFIG_ID = "test-model-ownership-owner-config";
const OTHER_CONFIG_ID = "test-model-ownership-other-config";

type ResolvedModel = {
  id: string;
  modelId: string;
  provider: { userId: string };
};

type GenerationResolver = (
  userId: string,
  modelConfigId?: string,
) => Promise<{ modelConfigId: string; modelId: string }>;

type OutlineResolver = (
  userId: string,
  modelConfigId?: string,
) => Promise<ResolvedModel>;

function generationResolver(): GenerationResolver {
  const resolver = generatorModule.resolveGenerationProvider;
  expect(resolver).toBeTypeOf("function");
  return resolver as GenerationResolver;
}

function outlineResolver(): OutlineResolver {
  const resolver = outlineWorkerModule.resolveOutlineChatModel;
  expect(resolver).toBeTypeOf("function");
  return resolver as OutlineResolver;
}

async function clearTestRows(): Promise<void> {
  invalidateResolveModelCache();
  await db.modelConfig.deleteMany({
    where: { id: { in: [OWNER_CONFIG_ID, OTHER_CONFIG_ID] } },
  });
  await db.modelProvider.deleteMany({
    where: { id: { in: [OWNER_PROVIDER_ID, OTHER_PROVIDER_ID] } },
  });
  await db.user.deleteMany({ where: { id: { in: [OWNER_ID, OTHER_USER_ID] } } });
}

async function seed(): Promise<void> {
  await clearTestRows();
  await db.user.createMany({
    data: [
      { id: OWNER_ID, username: OWNER_ID, passwordHash: "x" },
      { id: OTHER_USER_ID, username: OTHER_USER_ID, passwordHash: "x" },
    ],
  });
  await db.modelProvider.createMany({
    data: [
      {
        id: OWNER_PROVIDER_ID,
        userId: OWNER_ID,
        name: "Owner provider",
        providerType: "openai",
        apiBaseUrl: "http://owner.invalid",
        apiKey: "owner-key",
      },
      {
        id: OTHER_PROVIDER_ID,
        userId: OTHER_USER_ID,
        name: "Other provider",
        providerType: "openai",
        apiBaseUrl: "http://other.invalid",
        apiKey: "other-key",
      },
    ],
  });
  await db.modelConfig.createMany({
    data: [
      {
        id: OWNER_CONFIG_ID,
        providerId: OWNER_PROVIDER_ID,
        modelId: "owner-model",
        modelName: "Owner model",
        capabilities: '["chat"]',
        contextWindow: 8192,
        isDefaultFor: "llm",
      },
      {
        id: OTHER_CONFIG_ID,
        providerId: OTHER_PROVIDER_ID,
        modelId: "other-model",
        modelName: "Other model",
        capabilities: '["chat"]',
        contextWindow: 8192,
      },
    ],
  });
  invalidateResolveModelCache();
}

describe("ModelConfig ownership", () => {
  beforeEach(seed);
  afterEach(clearTestRows);

  describe("resolveModelOrFallback", () => {
    it("rejects an explicit config owned by another user", async () => {
      await expect(
        resolveModelOrFallback(OTHER_CONFIG_ID, "writing", OWNER_ID),
      ).rejects.toThrow(`Model config ${OTHER_CONFIG_ID} not found`);
    });

    it("allows an explicit config owned by the requesting user", async () => {
      const resolved = await resolveModelOrFallback(OWNER_CONFIG_ID, "writing", OWNER_ID);

      expect(resolved.id).toBe(OWNER_CONFIG_ID);
      expect((resolved.provider as unknown as { userId: string }).userId).toBe(OWNER_ID);
    });

    it("keeps fallback resolution scoped to the requesting user", async () => {
      const resolved = await resolveModelOrFallback(undefined, "writing", OWNER_ID);

      expect(resolved.id).toBe(OWNER_CONFIG_ID);
      expect((resolved.provider as unknown as { userId: string }).userId).toBe(OWNER_ID);
    });
  });

  describe("section generator explicit config", () => {
    it("rejects another user's config with the same error as not found", async () => {
      await expect(generationResolver()(OWNER_ID, OTHER_CONFIG_ID)).rejects.toThrow(
        `Model config ${OTHER_CONFIG_ID} not found`,
      );
    });

    it("allows the owner's explicit config without calling an LLM", async () => {
      const resolved = await generationResolver()(OWNER_ID, OWNER_CONFIG_ID);

      expect(resolved.modelConfigId).toBe(OWNER_CONFIG_ID);
      expect(resolved.modelId).toBe("owner-model");
    });
  });

  describe("outline worker explicit config", () => {
    it("rejects another user's config", async () => {
      await expect(outlineResolver()(OWNER_ID, OTHER_CONFIG_ID)).rejects.toThrow(
        "No chat model configured",
      );
    });

    it("allows the owner's explicit config and preserves fallback behavior", async () => {
      const explicit = await outlineResolver()(OWNER_ID, OWNER_CONFIG_ID);
      const fallback = await outlineResolver()(OWNER_ID);

      expect(explicit.id).toBe(OWNER_CONFIG_ID);
      expect(explicit.provider.userId).toBe(OWNER_ID);
      expect(fallback.id).toBe(OWNER_CONFIG_ID);
      expect(fallback.provider.userId).toBe(OWNER_ID);
    });
  });
});
