import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth before importing the route — session lookup is otherwise cookie-dependent.
let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

// Mock the embedding-dim probe + catalog so tests never hit the network and
// can assert the create flow wires them up correctly.
let mockDetectedDim: number | null = null;
let detectCallCount = 0;
let detectCallArgs: { baseUrl: string; modelId: string; hasAuth: boolean }[] = [];
let mockProbeThrows = false;
vi.mock("@/lib/llm/provider-probe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm/provider-probe")>(
    "@/lib/llm/provider-probe",
  );
  return {
    ...actual,
    detectEmbeddingDim: vi.fn(
      async (
        baseUrl: string,
        headers: Record<string, string>,
        model: { modelId: string },
      ): Promise<number | null> => {
        detectCallCount += 1;
        detectCallArgs.push({ baseUrl, modelId: model.modelId, hasAuth: !!headers.Authorization });
        if (mockProbeThrows) throw new Error("probe network error");
        return mockDetectedDim;
      },
    ),
  };
});

let mockCatalogDim: number | null = null;
vi.mock("@/lib/models/model-catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/models/model-catalog")>(
    "@/lib/models/model-catalog",
  );
  return {
    ...actual,
    lookupEmbeddingDim: vi.fn(async () => mockCatalogDim),
  };
});

import { db } from "@/lib/db";
import { POST } from "@/app/api/v1/models/providers/route";
import { detectEmbeddingDim } from "@/lib/llm/provider-probe";

const TEST_USER_ID = "test-providers-route-user";

async function clearTestRows(): Promise<void> {
  const providers = await db.modelProvider.findMany({ where: { userId: TEST_USER_ID } });
  if (providers.length > 0) {
    await db.modelConfig.deleteMany({ where: { providerId: { in: providers.map((p) => p.id) } } });
  }
  await db.modelProvider.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function postAs(
  body: Record<string, unknown>,
  authedUserId: string | null,
): Promise<{ status: number; json: any }> {
  mockUserId = authedUserId;
  const req = new Request("http://t/api/v1/models/providers", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

function embeddingPayload(modelId: string, apiKey?: string): Record<string, unknown> {
  return {
    name: "test-embed-provider",
    providerType: "openai_compatible",
    apiBaseUrl: "https://api.example.com/v1",
    ...(apiKey !== undefined ? { apiKey } : {}),
    models: [
      {
        modelId,
        modelName: modelId,
        capabilities: ["embedding"],
        contextWindow: 0,
      },
    ],
  };
}

describe("POST /api/v1/models/providers — embedding dim auto-detection", () => {
  beforeEach(async () => {
    mockUserId = null;
    mockDetectedDim = null;
    mockCatalogDim = null;
    mockProbeThrows = false;
    detectCallCount = 0;
    detectCallArgs = [];
    vi.clearAllMocks();
    await db.user.upsert({
      where: { id: TEST_USER_ID },
      create: { id: TEST_USER_ID, username: TEST_USER_ID, passwordHash: "test-hash" },
      update: {},
    });
  });
  afterEach(async () => {
    await clearTestRows();
  });

  it("auto-detects and persists the embedding dim on create", async () => {
    mockDetectedDim = 2048;
    const { status, json } = await postAs(embeddingPayload("text-embedding-v4", "sk-test"), TEST_USER_ID);

    expect(status).toBe(201);
    expect(json.success).toBe(true);
    // Response DTO carries the detected dim.
    expect(json.data.models[0].embeddingDim).toBe(2048);
    // DB row was updated.
    const created = await db.modelConfig.findFirst({
      where: { modelId: "text-embedding-v4" },
    });
    expect(created?.embeddingDim).toBe(2048);
  });

  it("passes the Authorization header built from the plaintext apiKey", async () => {
    mockDetectedDim = 1024;
    await postAs(embeddingPayload("emb-with-auth", "sk-secret"), TEST_USER_ID);

    expect(detectCallCount).toBe(1);
    expect(detectCallArgs[0].hasAuth).toBe(true);
    expect(detectCallArgs[0].modelId).toBe("emb-with-auth");
  });

  it("falls back to the catalog when the probe returns null", async () => {
    mockDetectedDim = null;
    mockCatalogDim = 1536;
    const { status, json } = await postAs(embeddingPayload("catalog-fallback", "sk-test"), TEST_USER_ID);

    expect(status).toBe(201);
    expect(json.data.models[0].embeddingDim).toBe(1536);
    const created = await db.modelConfig.findFirst({ where: { modelId: "catalog-fallback" } });
    expect(created?.embeddingDim).toBe(1536);
  });

  it("creates successfully with null dim when probe and catalog both fail", async () => {
    mockDetectedDim = null;
    mockCatalogDim = null;
    const { status, json } = await postAs(embeddingPayload("undetectable", "sk-test"), TEST_USER_ID);

    // Silent failure: creation still succeeds, dim stays null.
    expect(status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.models[0].embeddingDim).toBeNull();
    const created = await db.modelConfig.findFirst({ where: { modelId: "undetectable" } });
    expect(created?.embeddingDim).toBeNull();
  });

  it("does not probe LLM-only models", async () => {
    const body = {
      name: "llm-only-provider",
      providerType: "openai_compatible",
      apiBaseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      models: [{ modelId: "gpt-test", modelName: "GPT Test", capabilities: ["chat"], contextWindow: 8192 }],
    };
    const { status } = await postAs(body, TEST_USER_ID);

    expect(status).toBe(201);
    expect(detectCallCount).toBe(0);
    expect(detectEmbeddingDim).not.toHaveBeenCalled();
  });

  it("a probe error does not block creation", async () => {
    mockProbeThrows = true;
    mockCatalogDim = null;
    const { status, json } = await postAs(embeddingPayload("probe-error", "sk-test"), TEST_USER_ID);

    // Creation still succeeds; dim remains null (silent failure).
    expect(status).toBe(201);
    expect(json.success).toBe(true);
  });

  it("rejects an unauthenticated request", async () => {
    const { status } = await postAs(embeddingPayload("no-auth"), null);
    expect(status).toBe(401);
  });
});
