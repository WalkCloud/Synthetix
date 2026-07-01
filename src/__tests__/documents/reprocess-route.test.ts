import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth before importing the route.
let mockUserId: string | null = null;
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: async () => (mockUserId ? { id: mockUserId } : null),
}));

// Mock the queue so reprocess never actually runs a convert pipeline.
const submitted: { type: string; payload: Record<string, unknown> }[] = [];
vi.mock("@/lib/queue", () => ({
  getQueue: () => ({
    submit: (type: string, payload: Record<string, unknown>) => {
      submitted.push({ type, payload });
      return Promise.resolve(`task-${submitted.length}`);
    },
  }),
}));

// Mock processing-tasks helpers (cancel + wait) to no-ops so the route does
// not block on real task state.
vi.mock("@/lib/documents/processing-tasks", () => ({
  cancelActiveDocumentConvertTasks: () => Promise.resolve(),
  cancelActiveRagEmbedIndexTasks: () => Promise.resolve(),
  cancelActiveFollowupTasks: () => Promise.resolve(),
  waitForDocActiveTasksToSettle: () => Promise.resolve(),
}));

import { db } from "@/lib/db";
import { POST } from "@/app/api/v1/documents/[id]/reprocess/route";

const TEST_USER_ID = "test-reprocess-inherit-user";
const TEST_DOC_ID = "test-reprocess-inherit-doc";

async function seedDoc(): Promise<void> {
  await db.user.upsert({
    where: { id: TEST_USER_ID },
    create: { id: TEST_USER_ID, username: TEST_USER_ID, passwordHash: "x" },
    update: {},
  });
  await db.document.upsert({
    where: { id: TEST_DOC_ID },
    create: {
      id: TEST_DOC_ID,
      userId: TEST_USER_ID,
      originalName: "test.md",
      originalFormat: "md",
      originalSize: 100,
      originalHash: "h",
      originalPath: "/tmp/test.md",
      status: "ready",
    },
    update: { status: "ready" },
  });
}

async function seedPriorConvertTask(options: Record<string, unknown>): Promise<void> {
  await db.asyncTask.create({
    data: {
      userId: TEST_USER_ID,
      type: "document_convert",
      status: "completed",
      progress: 100,
      inputData: JSON.stringify({ docId: TEST_DOC_ID, options }),
    },
  });
}

async function clearTestRows(): Promise<void> {
  await db.asyncTask.deleteMany({
    where: { userId: TEST_USER_ID, type: "document_convert" },
  });
  await db.document.deleteMany({ where: { id: TEST_DOC_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
}

async function reprocessAs(
  body: Record<string, unknown> | null,
  authedUserId: string | null,
): Promise<{ status: number; json: any }> {
  mockUserId = authedUserId;
  const req = new Request(`http://t/api/v1/documents/${TEST_DOC_ID}/reprocess`, {
    method: "POST",
    body: body === null ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const res = await POST(req, { params: Promise.resolve({ id: TEST_DOC_ID }) } as any);
  return { status: res.status, json: await res.json() };
}

function lastSubmittedOptions(): Record<string, unknown> {
  const last = submitted[submitted.length - 1];
  return (last?.payload?.options as Record<string, unknown>) || {};
}

describe("POST /api/v1/documents/[id]/reprocess — options inheritance", () => {
  beforeEach(async () => {
    mockUserId = null;
    submitted.length = 0;
    await seedDoc();
  });
  afterEach(async () => {
    await clearTestRows();
  });

  it("inherits indexMode:graph from the prior convert task when caller sends no options", async () => {
    await seedPriorConvertTask({ indexMode: "graph", indexTarget: "full" });

    const { status } = await reprocessAs({}, TEST_USER_ID);
    expect(status).toBe(200);

    const opts = lastSubmittedOptions();
    // The whole point: graph mode must survive a no-options reprocess.
    expect(opts.indexMode).toBe("graph");
    expect(opts.indexTarget).toBe("full");
  });

  it("skips an empty-options prior task and inherits from the earlier graph task", async () => {
    // Oldest: real config with graph. Newest: an empty-options reprocess that
    // used to shadow it. We must recover graph, not inherit the empty {}.
    await seedPriorConvertTask({ indexMode: "graph", indexTarget: "full", splitStrategy: "structure-llm" });
    await seedPriorConvertTask({}); // empty options — would shadow under LIMIT 1

    const { status } = await reprocessAs({}, TEST_USER_ID);
    expect(status).toBe(200);

    const opts = lastSubmittedOptions();
    expect(opts.indexMode).toBe("graph");
    expect(opts.indexTarget).toBe("full");
    expect(opts.splitStrategy).toBe("structure-llm");
  });

  it("caller-provided options override inherited ones", async () => {
    await seedPriorConvertTask({ indexMode: "graph", indexTarget: "full" });

    // Caller explicitly asks for basic — must win over inherited graph.
    await reprocessAs({ options: { indexMode: "basic" } }, TEST_USER_ID);

    const opts = lastSubmittedOptions();
    expect(opts.indexMode).toBe("basic");
  });

  it("falls back to empty options (→ pipeline default basic) when no prior task exists", async () => {
    // No prior convert task seeded for this case.
    await reprocessAs({}, TEST_USER_ID);
    const opts = lastSubmittedOptions();
    // No inheritance, no caller options → empty object; pipeline defaults to basic.
    expect(opts.indexMode).toBeUndefined();
  });

  it("rejects an unauthenticated request", async () => {
    const { status } = await reprocessAs({}, null);
    expect(status).toBe(401);
  });
});
