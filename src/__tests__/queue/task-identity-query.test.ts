import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  cancelTasksByResourceIdentity,
  findTaskIdsByResourceIdentity,
  findTasksByResourceIdentity,
} from "@/lib/queue/task-identity-query";

const USER_ID = "task-identity-query-user";

describe("task identity queries", () => {
  beforeEach(async () => {
    await db.user.upsert({
      where: { id: USER_ID },
      create: { id: USER_ID, username: USER_ID, passwordHash: "test-hash" },
      update: {},
    });
    await db.asyncTask.deleteMany({ where: { userId: USER_ID } });
  });

  it("uses relational identity before conflicting legacy payload", async () => {
    await db.asyncTask.create({
      data: {
        id: "query-relational",
        userId: USER_ID,
        type: "document_convert",
        documentId: "doc-relational",
        inputData: JSON.stringify({ docId: "doc-legacy" }),
      },
    });

    expect(await findTaskIdsByResourceIdentity({
      userId: USER_ID,
      field: "documentId",
      value: "doc-relational",
    })).toContain("query-relational");
    expect(await findTaskIdsByResourceIdentity({
      userId: USER_ID,
      field: "documentId",
      value: "doc-legacy",
    })).not.toContain("query-relational");
  });

  it("matches exact legacy identity only when relational identity is null", async () => {
    await db.asyncTask.create({
      data: {
        id: "query-legacy",
        userId: USER_ID,
        type: "document_convert",
        inputData: JSON.stringify({ note: "doc-1", docId: "doc-10" }, null, 2),
      },
    });

    expect(await findTaskIdsByResourceIdentity({
      userId: USER_ID,
      field: "documentId",
      value: "doc-1",
    })).not.toContain("query-legacy");
    expect(await findTaskIdsByResourceIdentity({
      userId: USER_ID,
      field: "documentId",
      value: "doc-10",
    })).toContain("query-legacy");
  });

  it("classifies pending and running cancellation without terminalizing the running task", async () => {
    const pending = await db.asyncTask.create({
      data: {
        id: "query-cancel-pending",
        userId: USER_ID,
        type: "rag_index",
        status: "pending",
        documentId: "doc-cancel",
      },
    });
    const running = await db.asyncTask.create({
      data: {
        id: "query-cancel-running",
        userId: USER_ID,
        type: "wiki_synthesize",
        status: "running",
        documentId: "doc-cancel",
        leaseOwner: "worker-1",
        leaseExpiresAt: new Date("2026-01-01T00:10:00Z"),
      },
    });

    const result = await cancelTasksByResourceIdentity({
      userId: USER_ID,
      field: "documentId",
      value: "doc-cancel",
      statuses: ["pending", "running"],
      errorMessage: "superseded",
    });

    expect(result).toEqual({
      pendingIds: [pending.id],
      runningIds: [running.id],
    });
    const cancelledPending = await db.asyncTask.findUniqueOrThrow({ where: { id: pending.id } });
    expect(cancelledPending.status).toBe("cancelled");
    expect(cancelledPending.cancelRequestedAt).not.toBeNull();
    expect(cancelledPending.finishedAt).not.toBeNull();
    expect(cancelledPending.leaseOwner).toBeNull();
    expect(cancelledPending.leaseExpiresAt).toBeNull();

    const requestedRunning = await db.asyncTask.findUniqueOrThrow({ where: { id: running.id } });
    expect(requestedRunning.status).toBe("cancel_requested");
    expect(requestedRunning.cancelRequestedAt).not.toBeNull();
    expect(requestedRunning.finishedAt).toBeNull();
    expect(requestedRunning.leaseOwner).toBe("worker-1");
    expect(requestedRunning.leaseExpiresAt).not.toBeNull();
  });

  it("filters by type and status and preserves requested ordering", async () => {
    await db.asyncTask.createMany({
      data: [
        {
          id: "query-old",
          userId: USER_ID,
          type: "document_convert",
          status: "running",
          documentId: "doc-1",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "query-new",
          userId: USER_ID,
          type: "document_convert",
          status: "pending",
          documentId: "doc-1",
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
        {
          id: "query-other-type",
          userId: USER_ID,
          type: "rag_index",
          status: "pending",
          documentId: "doc-1",
          createdAt: new Date("2026-01-03T00:00:00Z"),
        },
      ],
    });

    const rows = await findTasksByResourceIdentity({
      userId: USER_ID,
      field: "documentId",
      value: "doc-1",
      types: ["document_convert"],
      statuses: ["pending", "running"],
      order: "desc",
      take: 1,
    });

    expect(rows.map((row) => row.id)).toEqual(["query-new"]);
  });
});
