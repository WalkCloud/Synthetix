import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { backfillAsyncTaskIdentity } from "@/lib/queue/task-identity-backfill";

const USER_ID = "task-identity-backfill-user";

async function createTask(input: {
  id: string;
  type: string;
  inputData: string | null;
  documentId?: string | null;
  draftId?: string | null;
  sessionId?: string | null;
  attempt?: number | null;
}) {
  await db.asyncTask.create({
    data: {
      id: input.id,
      userId: USER_ID,
      type: input.type,
      inputData: input.inputData,
      documentId: input.documentId,
      draftId: input.draftId,
      sessionId: input.sessionId,
      attempt: input.attempt,
    },
  });
}

describe("backfillAsyncTaskIdentity", () => {
  beforeEach(async () => {
    await db.user.upsert({
      where: { id: USER_ID },
      create: { id: USER_ID, username: USER_ID, passwordHash: "test-hash" },
      update: {},
    });
    await db.asyncTask.deleteMany({ where: { userId: USER_ID } });
  });

  afterEach(async () => {
    await db.asyncTask.deleteMany({ where: { userId: USER_ID } });
  });

  it("backfills reliable fields without inventing operation lineage", async () => {
    await createTask({
      id: "backfill-doc",
      type: "rag_index",
      inputData: JSON.stringify({
        docId: "doc-1",
        sourceTaskId: "not-a-parent-task",
        options: { _graphAttempt: 2 },
      }),
    });
    await createTask({
      id: "backfill-session",
      type: "outline_generate",
      inputData: JSON.stringify({ sessionId: "session-1" }),
    });

    const stats = await backfillAsyncTaskIdentity({ batchSize: 1 });
    const doc = await db.asyncTask.findUniqueOrThrow({ where: { id: "backfill-doc" } });
    const session = await db.asyncTask.findUniqueOrThrow({ where: { id: "backfill-session" } });

    expect(doc.documentId).toBe("doc-1");
    expect(doc.attempt).toBe(2);
    expect(doc.operationId).toBeNull();
    expect(doc.parentTaskId).toBeNull();
    expect(session.sessionId).toBe("session-1");
    expect(stats.updated).toBeGreaterThanOrEqual(2);
  });

  it("preserves populated relational values and reports mismatches", async () => {
    await createTask({
      id: "backfill-mismatch",
      type: "document_convert",
      inputData: JSON.stringify({ docId: "doc-legacy" }),
      documentId: "doc-relational",
      attempt: 0,
    });

    const stats = await backfillAsyncTaskIdentity();
    const task = await db.asyncTask.findUniqueOrThrow({ where: { id: "backfill-mismatch" } });

    expect(task.documentId).toBe("doc-relational");
    expect(stats.mismatch).toBeGreaterThanOrEqual(1);
  });

  it("continues past malformed and ambiguous rows and is idempotent", async () => {
    await createTask({ id: "backfill-a-malformed", type: "document_convert", inputData: "{" });
    await createTask({
      id: "backfill-b-ambiguous",
      type: "document_convert",
      inputData: JSON.stringify({ docId: "doc-1", draftId: "draft-1" }),
    });
    await createTask({
      id: "backfill-c-valid",
      type: "document_convert",
      inputData: JSON.stringify({ docId: "doc-2" }),
    });

    const first = await backfillAsyncTaskIdentity({ batchSize: 1 });
    const second = await backfillAsyncTaskIdentity({ batchSize: 1 });

    expect(first.malformed).toBeGreaterThanOrEqual(1);
    expect(first.ambiguous).toBeGreaterThanOrEqual(1);
    expect((await db.asyncTask.findUniqueOrThrow({ where: { id: "backfill-c-valid" } })).documentId).toBe("doc-2");
    expect(second.updated).toBe(0);
  });

  it("supports dry runs without writing", async () => {
    await createTask({
      id: "backfill-dry-run",
      type: "draft_generate_all",
      inputData: JSON.stringify({ draftId: "draft-1" }),
    });

    const stats = await backfillAsyncTaskIdentity({ dryRun: true });
    const task = await db.asyncTask.findUniqueOrThrow({ where: { id: "backfill-dry-run" } });

    expect(stats.updated).toBeGreaterThanOrEqual(1);
    expect(task.draftId).toBeNull();
  });
});
