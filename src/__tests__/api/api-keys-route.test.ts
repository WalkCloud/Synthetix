import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/v1/users/api-keys/route";
import { DELETE } from "@/app/api/v1/users/api-keys/[id]/route";
import { hashApiKey } from "@/lib/auth/api-key";

const OWNER_ID = "test-apikey-owner";
const OTHER_USER_ID = "test-apikey-other";

async function clearTestRows(): Promise<void> {
  await db.apiKey.deleteMany({ where: { userId: { in: [OWNER_ID, OTHER_USER_ID] } } });
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
}

describe("api-keys routes", () => {
  beforeEach(async () => {
    mockUserId = OWNER_ID;
    await seed();
  });

  afterEach(async () => {
    mockUserId = null;
    await clearTestRows();
  });

  it("rejects unauthenticated requests", async () => {
    mockUserId = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("creates a key and returns plaintext exactly once", async () => {
    const res = await POST(jsonRequest({ name: "Claude Code MCP" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    // 创建响应含明文。
    expect(body.data.key).toMatch(/^sk-synt-/);
    expect(body.data.name).toBe("Claude Code MCP");
    expect(body.data.id).toBeTruthy();

    // 列表接口绝不返回明文。
    const listRes = await GET();
    const listBody = await listRes.json();
    expect(listBody.data[0].key).toBeUndefined();
    expect(listBody.data[0].hashedKey).toBeUndefined();
    expect(listBody.data[0].status).toBe("active");
    expect(listBody.data[0].name).toBe("Claude Code MCP");
  });

  it("stores only the hash, not the plaintext", async () => {
    const res = await POST(jsonRequest({ name: "Codex" }));
    const { data } = await res.json();
    const row = await db.apiKey.findUnique({ where: { id: data.id } });
    expect(row?.hashedKey).toBe(hashApiKey(data.key));
    // 数据库行不应出现明文。
    expect(row?.hashedKey).not.toContain(data.key);
  });

  it("rejects creation without a name", async () => {
    const res = await POST(jsonRequest({ name: "" }));
    expect(res.status).toBe(400);
  });

  it("revokes a key (soft delete)", async () => {
    const createRes = await POST(jsonRequest({ name: "To Revoke" }));
    const { id } = (await createRes.json()).data;

    const revokeRes = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });
    expect(revokeRes.status).toBe(200);

    // 列表仍含该 key,但状态为 revoked。
    const listRes = await GET();
    const listBody = await listRes.json();
    const entry = listBody.data.find((k: { id: string }) => k.id === id);
    expect(entry.status).toBe("revoked");
    expect(entry.revokedAt).not.toBeNull();
  });

  it("returns 409 when revoking an already-revoked key", async () => {
    const createRes = await POST(jsonRequest({ name: "Double Revoke" }));
    const { id } = (await createRes.json()).data;

    await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });
    const second = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });
    expect(second.status).toBe(409);
  });

  it("returns 404 for a non-existent key", async () => {
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  it("isolates keys across users", async () => {
    mockUserId = OWNER_ID;
    const createRes = await POST(jsonRequest({ name: "Owner key" }));
    const { id } = (await createRes.json()).data;

    // 另一用户无法看到或吊销 owner 的 key。
    mockUserId = OTHER_USER_ID;
    const otherList = await GET();
    const otherBody = await otherList.json();
    expect(otherBody.data.find((k: { id: string }) => k.id === id)).toBeUndefined();

    const revokeRes = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    });
    expect(revokeRes.status).toBe(404);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
