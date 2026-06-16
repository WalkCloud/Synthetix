import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth before importing the route.
let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

import { db } from "@/lib/db";
import { GET } from "@/app/api/v1/models/usage/route";

const TEST_USER_ID = "test-models-usage-route-user";
const TEST_PROVIDER_ID = "test-models-usage-route-provider";
const TEST_MODEL_CONFIG_ID = "test-models-usage-route-config";

async function setup(): Promise<void> {
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
  await db.modelConfig.upsert({
    where: { id: TEST_MODEL_CONFIG_ID },
    create: {
      id: TEST_MODEL_CONFIG_ID,
      providerId: TEST_PROVIDER_ID,
      modelId: "deepseek-test",
      modelName: "deepseek-test",
      capabilities: '["chat"]',
      contextWindow: 8192,
    },
    update: {},
  });
}

async function clear(): Promise<void> {
  await db.tokenUsage.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.modelConfig.deleteMany({ where: { providerId: TEST_PROVIDER_ID } });
  await db.modelProvider.deleteMany({ where: { id: TEST_PROVIDER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function getUsage(): Promise<{ status: number; json: any }> {
  mockUserId = TEST_USER_ID;
  const req = new Request("http://t/api/v1/models/usage?days=30");
  const res = await GET(req);
  return { status: res.status, json: await res.json() };
}

describe("GET /api/v1/models/usage — null modelConfigId rows", () => {
  beforeEach(async () => {
    await clear();
    await setup();
  });
  afterEach(async () => {
    await clear();
  });

  it("byModel totals equal summary totals even when some rows have null modelConfigId", async () => {
    // Attributed row: 100 in / 50 out
    await db.tokenUsage.create({
      data: {
        userId: TEST_USER_ID,
        modelConfigId: TEST_MODEL_CONFIG_ID,
        module: "writing",
        inputTokens: 100,
        outputTokens: 50,
      },
    });
    // Unattributed row (e.g. legacy / Python LightRAG): 30 in / 0 out
    await db.tokenUsage.create({
      data: {
        userId: TEST_USER_ID,
        modelConfigId: null,
        module: "embedding",
        inputTokens: 30,
        outputTokens: 0,
      },
    });

    const { status, json } = await getUsage();
    expect(status).toBe(200);

    const summaryIn = json.data.summary.totalInputTokens;
    const summaryOut = json.data.summary.totalOutputTokens;
    expect(summaryIn).toBe(130);
    expect(summaryOut).toBe(50);

    const byModelIn = json.data.byModel.reduce(
      (sum: number, m: any) => sum + m.totalInputTokens,
      0,
    );
    const byModelOut = json.data.byModel.reduce(
      (sum: number, m: any) => sum + m.totalOutputTokens,
      0,
    );
    expect(byModelIn).toBe(summaryIn);
    expect(byModelOut).toBe(summaryOut);
  });

  it("exposes a row with modelConfigId=null for unattributed token usage", async () => {
    await db.tokenUsage.create({
      data: {
        userId: TEST_USER_ID,
        modelConfigId: null,
        module: "embedding",
        inputTokens: 30,
        outputTokens: 0,
      },
    });

    const { json } = await getUsage();
    const unattributed = json.data.byModel.find(
      (m: any) => m.modelConfigId === null,
    );
    expect(unattributed).toBeDefined();
    expect(unattributed.totalInputTokens).toBe(30);
    expect(unattributed.totalOutputTokens).toBe(0);
    expect(unattributed.totalCalls).toBe(1);
    expect(typeof unattributed.modelName).toBe("string");
    expect(unattributed.modelName.length).toBeGreaterThan(0);
  });

  it("modelsUsed counts the unattributed bucket as one model", async () => {
    await db.tokenUsage.create({
      data: {
        userId: TEST_USER_ID,
        modelConfigId: TEST_MODEL_CONFIG_ID,
        module: "writing",
        inputTokens: 100,
        outputTokens: 50,
      },
    });
    await db.tokenUsage.create({
      data: {
        userId: TEST_USER_ID,
        modelConfigId: null,
        module: "embedding",
        inputTokens: 30,
        outputTokens: 0,
      },
    });

    const { json } = await getUsage();
    expect(json.data.summary.modelsUsed).toBe(2);
  });
});
