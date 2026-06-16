import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth before importing the route — session lookup is otherwise cookie-dependent.
let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

import { db } from "@/lib/db";
import { PATCH } from "@/app/api/v1/models/configs/[id]/default/route";

const TEST_USER_ID = "test-default-slot-route-user";
const TEST_PROVIDER_ID = "test-default-slot-route-provider";

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
  await db.modelConfig.deleteMany({ where: { providerId: TEST_PROVIDER_ID } });
  await db.modelProvider.deleteMany({ where: { id: TEST_PROVIDER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function createModel(modelId: string, capabilities: string): Promise<string> {
  const m = await db.modelConfig.create({
    data: {
      providerId: TEST_PROVIDER_ID,
      modelId,
      modelName: modelId,
      capabilities,
      contextWindow: 8192,
    },
  });
  return m.id;
}

async function patchAs(
  configId: string,
  body: { setDefault: boolean; defaultFor: string },
  authedUserId: string | null,
): Promise<{ status: number; json: any }> {
  mockUserId = authedUserId;
  const req = new Request(`http://t/api/v1/models/configs/${configId}/default`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const res = await PATCH(req, { params: Promise.resolve({ id: configId }) } as any);
  return { status: res.status, json: await res.json() };
}

describe("PATCH /api/v1/models/configs/[id]/default — capability validation", () => {
  beforeEach(async () => {
    await clearTestRows();
    await setupUserAndProvider();
  });
  afterEach(async () => {
    await clearTestRows();
  });

  it("rejects setting a rerank-only model as the LLM default (regression: qwen3-rerank bug)", async () => {
    const id = await createModel("qwen3-rerank", '["rerank"]');
    const { status, json } = await patchAs(
      id,
      { setDefault: true, defaultFor: "llm" },
      TEST_USER_ID,
    );
    expect(status).toBe(400);
    expect(json.error?.code ?? json.code).toMatch(/capabilityMismatch|invalid/i);
    const after = await db.modelConfig.findUnique({ where: { id } });
    expect(after?.isDefaultFor).toBeNull();
  });

  it("rejects setting an embedding model as the LLM default", async () => {
    const id = await createModel("text-embedding-v4", '["embedding"]');
    const { status } = await patchAs(
      id,
      { setDefault: true, defaultFor: "llm" },
      TEST_USER_ID,
    );
    expect(status).toBe(400);
  });

  it("accepts setting a chat model as the LLM default", async () => {
    const id = await createModel("deepseek-v4-flash", '["chat"]');
    const { status } = await patchAs(
      id,
      { setDefault: true, defaultFor: "llm" },
      TEST_USER_ID,
    );
    expect(status).toBe(200);
    const after = await db.modelConfig.findUnique({ where: { id } });
    expect(after?.isDefaultFor).toBe("llm");
  });

  it("accepts setting an embedding model as the embedding default", async () => {
    const id = await createModel("text-embedding-v4", '["embedding"]');
    const { status } = await patchAs(
      id,
      { setDefault: true, defaultFor: "embedding" },
      TEST_USER_ID,
    );
    expect(status).toBe(200);
    const after = await db.modelConfig.findUnique({ where: { id } });
    expect(after?.isDefaultFor).toBe("embedding");
  });

  it("accepts setting a rerank model as the rerank default", async () => {
    const id = await createModel("qwen3-rerank", '["rerank"]');
    const { status } = await patchAs(
      id,
      { setDefault: true, defaultFor: "rerank" },
      TEST_USER_ID,
    );
    expect(status).toBe(200);
    const after = await db.modelConfig.findUnique({ where: { id } });
    expect(after?.isDefaultFor).toBe("rerank");
  });
});
