import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { cancelActiveFollowupTasks } from "@/lib/documents/processing-tasks";

const TEST_USER_ID = "test-followup-cancel-user";
const TEST_DOC_ID = "test-followup-cancel-doc";

describe("cancelActiveFollowupTasks", () => {
  beforeEach(async () => {
    await db.user.upsert({
      where: { id: TEST_USER_ID },
      create: { id: TEST_USER_ID, username: TEST_USER_ID, passwordHash: "test-hash" },
      update: {},
    });
    await db.asyncTask.deleteMany({ where: { userId: TEST_USER_ID } });
  });

  it("cancels pending/running rag_index and wiki_synthesize for the same doc", async () => {
    const graphPending = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "rag_index",
        status: "pending",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });
    const wikiRunning = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "wiki_synthesize",
        status: "running",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });

    await cancelActiveFollowupTasks(TEST_USER_ID, TEST_DOC_ID);

    const rows = await db.asyncTask.findMany({ where: { userId: TEST_USER_ID } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(graphPending.id)?.status).toBe("cancelled");
    expect(byId.get(wikiRunning.id)?.status).toBe("cancelled");
  });

  it("leaves other documents' follow-up tasks untouched", async () => {
    const otherDocGraph = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "rag_index",
        status: "running",
        inputData: JSON.stringify({ docId: "other-doc" }),
      },
    });

    await cancelActiveFollowupTasks(TEST_USER_ID, TEST_DOC_ID);

    const row = await db.asyncTask.findUnique({ where: { id: otherDocGraph.id } });
    expect(row?.status).toBe("running");
  });

  it("does NOT cancel document_convert or rag_embed_index (owned by other cancellers)", async () => {
    const convert = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });
    const embed = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "rag_embed_index",
        status: "running",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });

    await cancelActiveFollowupTasks(TEST_USER_ID, TEST_DOC_ID);

    expect((await db.asyncTask.findUnique({ where: { id: convert.id } }))?.status).toBe("running");
    expect((await db.asyncTask.findUnique({ where: { id: embed.id } }))?.status).toBe("running");
  });

  it("leaves already-terminal tasks alone", async () => {
    const completedGraph = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "rag_index",
        status: "completed",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });

    await cancelActiveFollowupTasks(TEST_USER_ID, TEST_DOC_ID);

    expect((await db.asyncTask.findUnique({ where: { id: completedGraph.id } }))?.status).toBe("completed");
  });

  it("respects the exceptTaskId exclusion", async () => {
    const keep = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "rag_index",
        status: "running",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });
    const cancel = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "rag_index",
        status: "pending",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });

    await cancelActiveFollowupTasks(TEST_USER_ID, TEST_DOC_ID, keep.id);

    expect((await db.asyncTask.findUnique({ where: { id: keep.id } }))?.status).toBe("running");
    expect((await db.asyncTask.findUnique({ where: { id: cancel.id } }))?.status).toBe("cancelled");
  });
});
