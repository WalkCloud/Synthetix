import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { cancelActiveDocumentConvertTasks, isLatestDocumentConvertTask } from "@/lib/documents/processing-tasks";

const TEST_USER_ID = "test-processing-tasks-user";
const TEST_DOC_ID = "test-processing-tasks-doc";

describe("cancelActiveDocumentConvertTasks", () => {
  beforeEach(async () => {
    await db.user.upsert({
      where: { id: TEST_USER_ID },
      create: { id: TEST_USER_ID, username: TEST_USER_ID, passwordHash: "test-hash" },
      update: {},
    });
    await db.asyncTask.deleteMany({ where: { userId: TEST_USER_ID } });
  });

  it("cancels pending and running conversion tasks for the same document", async () => {
    const stalePending = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "pending",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });
    const staleRunning = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });
    const otherDoc = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        inputData: JSON.stringify({ docId: "other-doc" }),
      },
    });

    await cancelActiveDocumentConvertTasks(TEST_USER_ID, TEST_DOC_ID);

    const rows = await db.asyncTask.findMany({ where: { userId: TEST_USER_ID } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(stalePending.id)?.status).toBe("cancelled");
    expect(byId.get(staleRunning.id)?.status).toBe("cancelled");
    expect(byId.get(otherDoc.id)?.status).toBe("running");
  });

  it("identifies only the newest conversion task for a document as current", async () => {
    const oldTask = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });
    const newTask = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "pending",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });

    await expect(isLatestDocumentConvertTask(TEST_USER_ID, TEST_DOC_ID, oldTask.id)).resolves.toBe(false);
    await expect(isLatestDocumentConvertTask(TEST_USER_ID, TEST_DOC_ID, newTask.id)).resolves.toBe(true);
  });
});
