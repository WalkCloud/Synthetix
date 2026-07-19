import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  findTasks: vi.fn(),
  cancel: vi.fn(),
  awaitTaskExecutions: vi.fn(),
  db: {
    brainstormSession: { findFirst: vi.fn(), update: vi.fn() },
    message: { deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/queue", () => ({
  getQueue: () => ({ cancel: mocks.cancel }),
  executionRegistry: { awaitTaskExecutions: mocks.awaitTaskExecutions },
}));
vi.mock("@/lib/queue/task-identity-query", () => ({
  findTasksByResourceIdentity: mocks.findTasks,
}));
vi.mock("@/lib/brainstorm/messages", () => ({
  getBrainstormMessages: (locale: string) => ({ outlineReady: `${locale}-ready` }),
}));

import { PATCH } from "@/app/api/v1/brainstorm/sessions/[id]/route";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "user" });
  mocks.db.brainstormSession.findFirst.mockResolvedValue({ id: "session" });
  mocks.db.brainstormSession.update.mockResolvedValue({});
  mocks.db.message.deleteMany.mockResolvedValue({ count: 0 });
  mocks.cancel.mockResolvedValue(true);
});

describe("clearOutline cancellation barrier", () => {
  it("does not clear persisted state until each cancelled outline execution settles", async () => {
    mocks.findTasks.mockResolvedValue([{ id: "outline-task" }]);
    const settled = deferred();
    mocks.awaitTaskExecutions.mockReturnValue(settled.promise);

    const responsePromise = PATCH(
      new Request("http://t/api/v1/brainstorm/sessions/session", {
        method: "PATCH",
        body: JSON.stringify({ action: "clearOutline" }),
      }),
      { params: Promise.resolve({ id: "session" }) },
    );

    await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("outline-task"));
    await vi.waitFor(() => expect(mocks.awaitTaskExecutions).toHaveBeenCalledWith(
      ["outline-task"],
      { timeoutMs: 30_000 },
    ));
    expect(mocks.db.message.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.brainstormSession.update).not.toHaveBeenCalled();

    settled.resolve();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(mocks.db.message.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.brainstormSession.update).toHaveBeenCalledWith({
      where: { id: "session" },
      data: { outline: null },
    });
  });
});
