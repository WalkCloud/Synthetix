import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { TaskQueue } from "@/lib/queue/queue";

const USER_ID = "task-lineage-user";

describe("TaskQueue lineage", () => {
  let queue: TaskQueue;

  beforeEach(async () => {
    queue = new TaskQueue({ concurrency: 0 });
    queue.registerWorker("document_convert", async () => ({ ok: true }));
    queue.registerWorker("rag_embed_index", async () => ({ ok: true }));
    queue.registerWorker("rag_index", async () => ({ ok: true }));

    await db.user.upsert({
      where: { id: USER_ID },
      create: { id: USER_ID, username: USER_ID, passwordHash: "test-hash" },
      update: {},
    });
    await db.asyncTask.deleteMany({ where: { userId: USER_ID } });
  });

  it("inherits operation and parent identity for follow-up tasks", async () => {
    const parentId = await queue.submit("document_convert", { docId: "doc-1" }, USER_ID);
    const childPayload = { docId: "doc-1", sourceTaskId: "legacy-doc-value" };
    const childId = await queue.submit(
      "rag_embed_index",
      childPayload,
      USER_ID,
      { parentTaskId: parentId },
    );

    const parent = await db.asyncTask.findUniqueOrThrow({ where: { id: parentId } });
    const child = await db.asyncTask.findUniqueOrThrow({ where: { id: childId } });

    expect(child.operationId).toBe(parent.operationId);
    expect(child.parentTaskId).toBe(parentId);
    expect(child.attempt).toBe(0);
    expect(child.documentId).toBe("doc-1");
    expect(JSON.parse(child.inputData || "{}")).toEqual(childPayload);
  });

  it("increments graph retry attempts without changing legacy retry input", async () => {
    const rootId = await queue.submit("document_convert", { docId: "doc-1" }, USER_ID);
    const embedId = await queue.submit("rag_embed_index", { docId: "doc-1" }, USER_ID, {
      parentTaskId: rootId,
    });
    const graphId = await queue.submit("rag_index", { docId: "doc-1" }, USER_ID, {
      parentTaskId: embedId,
    });
    const retryPayload = { docId: "doc-1", options: { indexMode: "graph", _graphAttempt: 1 } };
    const retryId = await queue.submit("rag_index", retryPayload, USER_ID, {
      parentTaskId: graphId,
    });

    const graph = await db.asyncTask.findUniqueOrThrow({ where: { id: graphId } });
    const retry = await db.asyncTask.findUniqueOrThrow({ where: { id: retryId } });

    expect(retry.operationId).toBe(graph.operationId);
    expect(retry.parentTaskId).toBe(graphId);
    expect(retry.attempt).toBe(1);
    expect(JSON.parse(retry.inputData || "{}")).toEqual(retryPayload);
  });
});
