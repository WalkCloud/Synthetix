import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  InvalidTaskIdentityError,
  inferTaskResourceIdentity,
  resolveTaskIdentity,
} from "@/lib/queue/task-identity";

const USER_ID = "task-identity-user";
const OTHER_USER_ID = "task-identity-other-user";

beforeEach(async () => {
  await db.user.upsert({
    where: { id: USER_ID },
    create: { id: USER_ID, username: USER_ID, passwordHash: "test-hash" },
    update: {},
  });
  await db.user.upsert({
    where: { id: OTHER_USER_ID },
    create: { id: OTHER_USER_ID, username: OTHER_USER_ID, passwordHash: "test-hash" },
    update: {},
  });
  await db.asyncTask.deleteMany({
    where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
  });
});

describe("task resource identity", () => {
  it.each([
    ["document_convert", { docId: "doc-1" }],
    ["document_cleanup", { docId: "doc-1" }],
    ["document_segment", { docId: "doc-1" }],
    ["rag_embed_index", { docId: "doc-1", sourceTaskId: "legacy-value" }],
    ["rag_index", { docId: "doc-1" }],
    ["wiki_synthesize", { docId: "doc-1" }],
  ] as const)("infers document identity for %s", (type, payload) => {
    expect(inferTaskResourceIdentity(type, payload)).toEqual({
      documentId: "doc-1",
      draftId: null,
      sectionId: null,
      sessionId: null,
    });
  });

  it("keeps outline identity scoped to the brainstorm session", () => {
    expect(inferTaskResourceIdentity("outline_generate", { sessionId: "session-1" })).toEqual({
      documentId: null,
      draftId: null,
      sectionId: null,
      sessionId: "session-1",
    });
  });

  it("keeps bulk writing identity scoped to the draft", () => {
    expect(inferTaskResourceIdentity("draft_generate_all", { draftId: "draft-1" })).toEqual({
      documentId: null,
      draftId: "draft-1",
      sectionId: null,
      sessionId: null,
    });
  });

  it("allows resource-less test tasks", () => {
    expect(inferTaskResourceIdentity("_test_upload", { filename: "test.pdf" })).toEqual({
      documentId: null,
      draftId: null,
      sectionId: null,
      sessionId: null,
    });
  });

  it.each([
    ["document_convert", {}],
    ["outline_generate", { sessionId: " " }],
    ["draft_generate_all", { draftId: 123 }],
  ] as const)("rejects missing required identity for %s", (type, payload) => {
    expect(() => inferTaskResourceIdentity(type, payload)).toThrow(InvalidTaskIdentityError);
  });
});

describe("task lineage identity", () => {
  it("generates a top-level operation identity", async () => {
    const identity = await resolveTaskIdentity({
      type: "document_convert",
      payload: { docId: "doc-1" },
      userId: USER_ID,
    });

    expect(identity).toMatchObject({
      documentId: "doc-1",
      parentTaskId: null,
      attempt: 0,
    });
    expect(identity.operationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("inherits operation identity from a valid parent", async () => {
    await db.asyncTask.create({
      data: {
        id: "parent-convert",
        userId: USER_ID,
        type: "document_convert",
        inputData: JSON.stringify({ docId: "doc-1" }),
        documentId: "doc-1",
        operationId: "operation-1",
        attempt: 0,
      },
    });

    const identity = await resolveTaskIdentity({
      type: "rag_embed_index",
      payload: { docId: "doc-1" },
      userId: USER_ID,
      options: { parentTaskId: "parent-convert" },
    });

    expect(identity).toMatchObject({
      documentId: "doc-1",
      operationId: "operation-1",
      parentTaskId: "parent-convert",
      attempt: 0,
    });
  });

  it("increments the relational attempt for graph retries", async () => {
    await db.asyncTask.create({
      data: {
        id: "parent-graph",
        userId: USER_ID,
        type: "rag_index",
        inputData: JSON.stringify({ docId: "doc-1", options: { _graphAttempt: 2 } }),
        documentId: "doc-1",
        operationId: "operation-1",
        attempt: 2,
      },
    });

    const identity = await resolveTaskIdentity({
      type: "rag_index",
      payload: { docId: "doc-1", options: { _graphAttempt: 3 } },
      userId: USER_ID,
      options: { parentTaskId: "parent-graph" },
    });

    expect(identity.attempt).toBe(3);
    expect(identity.operationId).toBe("operation-1");
  });

  it("lazily upgrades legacy parents before creating a follow-up", async () => {
    await db.asyncTask.create({
      data: {
        id: "legacy-parent",
        userId: USER_ID,
        type: "document_convert",
        inputData: JSON.stringify({ docId: "doc-1" }),
      },
    });

    const identity = await resolveTaskIdentity({
      type: "rag_embed_index",
      payload: { docId: "doc-1" },
      userId: USER_ID,
      options: { parentTaskId: "legacy-parent" },
    });
    const parent = await db.asyncTask.findUniqueOrThrow({ where: { id: "legacy-parent" } });

    expect(identity.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(parent.operationId).toBe(identity.operationId);
    expect(parent.documentId).toBe("doc-1");
    expect(parent.attempt).toBe(0);
  });

  it("uses the legacy graph attempt when upgrading a retry parent", async () => {
    await db.asyncTask.create({
      data: {
        id: "legacy-graph-parent",
        userId: USER_ID,
        type: "rag_index",
        inputData: JSON.stringify({ docId: "doc-1", options: { _graphAttempt: 2 } }),
      },
    });

    const identity = await resolveTaskIdentity({
      type: "rag_index",
      payload: { docId: "doc-1", options: { _graphAttempt: 3 } },
      userId: USER_ID,
      options: { parentTaskId: "legacy-graph-parent" },
    });

    expect(identity.attempt).toBe(3);
  });

  it("rejects cross-user parents", async () => {
    await db.asyncTask.create({
      data: {
        id: "other-parent",
        userId: OTHER_USER_ID,
        type: "document_convert",
        inputData: JSON.stringify({ docId: "doc-1" }),
        documentId: "doc-1",
        operationId: "operation-1",
        attempt: 0,
      },
    });

    await expect(resolveTaskIdentity({
      type: "rag_embed_index",
      payload: { docId: "doc-1" },
      userId: USER_ID,
      options: { parentTaskId: "other-parent" },
    })).rejects.toThrow(InvalidTaskIdentityError);
  });

  it("rejects cross-document follow-ups", async () => {
    await db.asyncTask.create({
      data: {
        id: "parent-convert",
        userId: USER_ID,
        type: "document_convert",
        inputData: JSON.stringify({ docId: "doc-1" }),
        documentId: "doc-1",
        operationId: "operation-1",
        attempt: 0,
      },
    });

    await expect(resolveTaskIdentity({
      type: "rag_embed_index",
      payload: { docId: "doc-2" },
      userId: USER_ID,
      options: { parentTaskId: "parent-convert" },
    })).rejects.toThrow(InvalidTaskIdentityError);
  });
});
