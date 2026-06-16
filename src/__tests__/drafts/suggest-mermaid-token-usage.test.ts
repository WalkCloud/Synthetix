import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Auth mock — must be hoisted before importing the route.
let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

// LLM provider mock — keep the route's chat call deterministic and offline.
const chatMock = vi.fn();
vi.mock("@/lib/llm/factory", () => ({
  createLLMProvider: () => ({
    chat: chatMock,
  }),
}));

// resolveModel mock — return a fake writing model bound to our test provider.
vi.mock("@/lib/llm/resolve-model", () => ({
  resolveModel: async () => ({
    id: "test-suggest-mermaid-model-config",
    modelId: "suggest-mermaid-model",
    provider: { apiBaseUrl: "http://localhost", apiKey: "test-key" },
  }),
}));

import { db } from "@/lib/db";
import { POST } from "@/app/api/v1/drafts/[id]/sections/[secId]/assets/suggest-mermaid/route";

const TEST_USER_ID = "test-suggest-mermaid-user";
const TEST_DRAFT_ID = "test-suggest-mermaid-draft";
const TEST_SECTION_ID = "test-suggest-mermaid-section";
const TEST_PROVIDER_ID = "test-suggest-mermaid-provider";
const TEST_MODEL_CONFIG_ID = "test-suggest-mermaid-model-config";

async function setupUserAndDraft(): Promise<void> {
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
      modelId: "suggest-mermaid-model",
      modelName: "suggest-mermaid-model",
      capabilities: '["chat"]',
      contextWindow: 8192,
    },
    update: {},
  });
  await db.draft.upsert({
    where: { id: TEST_DRAFT_ID },
    create: {
      id: TEST_DRAFT_ID,
      userId: TEST_USER_ID,
      title: "test-suggest-mermaid-draft",
      outline: "[]",
    },
    update: {},
  });
}

async function clearTestRows(): Promise<void> {
  await db.tokenUsage.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.draft.deleteMany({ where: { id: TEST_DRAFT_ID } });
  await db.modelConfig.deleteMany({ where: { id: TEST_MODEL_CONFIG_ID } });
  await db.modelProvider.deleteMany({ where: { id: TEST_PROVIDER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function postAs(authedUserId: string | null, content: string): Promise<{ status: number; json: any }> {
  mockUserId = authedUserId;
  const req = new Request(
    `http://t/api/v1/drafts/${TEST_DRAFT_ID}/sections/${TEST_SECTION_ID}/assets/suggest-mermaid`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  const res = await POST(req, {
    params: Promise.resolve({ id: TEST_DRAFT_ID, secId: TEST_SECTION_ID }),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /api/v1/drafts/[id]/sections/[secId]/assets/suggest-mermaid — token usage", () => {
  beforeEach(async () => {
    await clearTestRows();
    await setupUserAndDraft();
    chatMock.mockReset();
  });
  afterEach(async () => {
    await clearTestRows();
  });

  it("records a TokenUsage row with module='mermaid' on a successful suggestion", async () => {
    chatMock.mockResolvedValue({
      content: "Architecture diagram: API Gateway -> Service",
      inputTokens: 42,
      outputTokens: 17,
    });

    const { status, json } = await postAs(TEST_USER_ID, "Some section content describing services.");
    expect(status).toBe(200);
    expect(json.data?.suggestion).toContain("Architecture");

    const rows = await db.tokenUsage.findMany({ where: { userId: TEST_USER_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0].module).toBe("mermaid");
    expect(rows[0].inputTokens).toBe(42);
    expect(rows[0].outputTokens).toBe(17);
    expect(rows[0].modelConfigId).toBe("test-suggest-mermaid-model-config");
  });
});
