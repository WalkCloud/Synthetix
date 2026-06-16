import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the LLM factory so the dimension probe doesn't reach a real network.
const embedMock = vi.fn();
vi.mock("@/lib/llm/factory", () => ({
  createLLMProvider: () => ({
    embed: embedMock,
  }),
}));

import { db } from "@/lib/db";
import { resolveEmbeddingDim } from "@/lib/rag/dimension";

const TEST_USER_ID = "test-dim-probe-user";
const TEST_PROVIDER_ID = "test-dim-probe-provider";

async function setupUserAndProvider(): Promise<void> {
  await db.user.upsert({
    where: { id: TEST_USER_ID },
    create: { id: TEST_USER_ID, username: TEST_USER_ID, passwordHash: "test-hash" },
    update: {},
  });
  await db.modelProvider.upsert({
    where: { id: TEST_PROVIDER_ID },
    create: {
      id: TEST_PROVIDER_ID,
      userId: TEST_USER_ID,
      name: "test-provider",
      providerType: "openai",
      apiBaseUrl: "http://localhost",
      apiKey: "test-key",
      isActive: true,
    },
    update: {},
  });
}

async function clearTestRows(): Promise<void> {
  await db.tokenUsage.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.modelConfig.deleteMany({ where: { providerId: TEST_PROVIDER_ID } });
  await db.modelProvider.deleteMany({ where: { id: TEST_PROVIDER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function createUnprobedEmbedModel(modelId: string): Promise<any> {
  const m = await db.modelConfig.create({
    data: {
      providerId: TEST_PROVIDER_ID,
      modelId,
      modelName: modelId,
      capabilities: '["embedding"]',
      contextWindow: 8192,
    },
    include: { provider: true },
  });
  return m;
}

describe("resolveEmbeddingDim — token usage reporting", () => {
  beforeEach(async () => {
    await clearTestRows();
    await setupUserAndProvider();
    embedMock.mockReset();
  });
  afterEach(async () => {
    await clearTestRows();
  });

  it("records a TokenUsage row with module='embedding' on a successful probe", async () => {
    embedMock.mockResolvedValue({
      embeddings: [new Array(1536).fill(0.001)],
      inputTokens: 7,
    });

    const model = await createUnprobedEmbedModel("text-embedding-test");
    const dim = await resolveEmbeddingDim(model);
    expect(dim).toBe(1536);

    const rows = await db.tokenUsage.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0].module).toBe("embedding");
    expect(rows[0].inputTokens).toBe(7);
    expect(rows[0].outputTokens).toBe(0);
    expect(rows[0].modelConfigId).toBe(model.id);
  });

  it("does NOT record token usage when the probe fails (provider throws)", async () => {
    embedMock.mockRejectedValue(new Error("network down"));

    const model = await createUnprobedEmbedModel("text-embedding-broken");
    await expect(resolveEmbeddingDim(model)).rejects.toThrow();

    const rows = await db.tokenUsage.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(0);
  });

  it("skips the probe entirely (and records nothing) when embeddingDim is already cached", async () => {
    const model = await createUnprobedEmbedModel("text-embedding-cached");
    await db.modelConfig.update({
      where: { id: model.id },
      data: { embeddingDim: 1024 },
    });
    const cached = await db.modelConfig.findUnique({
      where: { id: model.id },
      include: { provider: true },
    });

    const dim = await resolveEmbeddingDim(cached!);
    expect(dim).toBe(1024);
    expect(embedMock).not.toHaveBeenCalled();
    const rows = await db.tokenUsage.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(0);
  });
});
