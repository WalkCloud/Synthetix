import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth before importing the route.
let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

import { db } from "@/lib/db";
import { GET as libraryGET } from "@/app/api/v1/library/documents/route";

const TEST_USER_ID = "test-library-pending-user";
// Stable, recognisable doc ids per status so the assertions read clearly.
const DOC = {
  pending: "test-library-doc-pending",
  queued: "test-library-doc-queued",
  ready: "test-library-doc-ready",
  failed: "test-library-doc-failed",
};

async function seedDoc(id: string, status: string, name: string): Promise<void> {
  await db.document.upsert({
    where: { id },
    create: {
      id,
      userId: TEST_USER_ID,
      originalName: name,
      originalFormat: "md",
      originalSize: 100,
      originalHash: `hash-${id}`,
      originalPath: `/tmp/${name}`,
      status: status as any,
    },
    update: { status: status as any },
  });
}

async function clearTestRows(): Promise<void> {
  await db.document.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function listAs(
  queryString: string,
  authedUserId: string | null,
): Promise<{ status: number; json: any }> {
  mockUserId = authedUserId;
  const req = new Request(`http://t/api/v1/library/documents?${queryString}`);
  const res = await libraryGET(req);
  return { status: res.status, json: await res.json() };
}

describe("GET /api/v1/library/documents — pending filtering", () => {
  beforeEach(async () => {
    mockUserId = null;
    await db.user.upsert({
      where: { id: TEST_USER_ID },
      create: { id: TEST_USER_ID, username: TEST_USER_ID, passwordHash: "x" },
      update: {},
    });
    // Seed one doc in each meaningful status so the default list and the
    // explicit status=pending filter can be told apart.
    await seedDoc(DOC.pending, "pending", "pending.md");
    await seedDoc(DOC.queued, "queued", "queued.md");
    await seedDoc(DOC.ready, "ready", "ready.md");
    await seedDoc(DOC.failed, "failed", "failed.md");
  });
  afterEach(async () => {
    await clearTestRows();
  });

  it("hides pending documents from the default list", async () => {
    const { status, json } = await listAs("page=1&limit=20", TEST_USER_ID);
    expect(status).toBe(200);
    const ids = json.data.map((d: any) => d.id);
    expect(ids).not.toContain(DOC.pending);
    // Other statuses are still listed.
    expect(ids).toContain(DOC.queued);
    expect(ids).toContain(DOC.ready);
    expect(ids).toContain(DOC.failed);
    // The reported total excludes pending too.
    expect(json.total).toBe(3);
  });

  it("returns pending documents only when explicitly filtered by status=pending", async () => {
    const { status, json } = await listAs("status=pending", TEST_USER_ID);
    expect(status).toBe(200);
    const ids = json.data.map((d: any) => d.id);
    expect(ids).toEqual([DOC.pending]);
    expect(json.total).toBe(1);
  });

  it("still returns non-pending docs for an explicit non-pending status filter", async () => {
    const { status, json } = await listAs("status=ready", TEST_USER_ID);
    expect(status).toBe(200);
    const ids = json.data.map((d: any) => d.id);
    expect(ids).toEqual([DOC.ready]);
  });
});
