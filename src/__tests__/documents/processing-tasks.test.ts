import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  aggregateDocumentProcessingTiming,
  cancelActiveDocumentConvertTasks,
  isLatestDocumentConvertTask,
  selectLatestDocumentProcessingRound,
} from "@/lib/documents/processing-tasks";

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
    expect(byId.get(stalePending.id)?.finishedAt).not.toBeNull();
    expect(byId.get(staleRunning.id)?.status).toBe("cancelled");
    expect(byId.get(staleRunning.id)?.cancelRequestedAt).not.toBeNull();
    expect(byId.get(staleRunning.id)?.finishedAt).not.toBeNull();
    expect(byId.get(otherDoc.id)?.status).not.toBe("cancelled");
    expect(byId.get(otherDoc.id)?.status).not.toBe("cancel_requested");
  });

  it("uses relational identity before conflicting legacy payloads", async () => {
    const relationalMatch = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        documentId: TEST_DOC_ID,
        inputData: JSON.stringify({ docId: "other-doc" }),
      },
    });
    const legacyConflict = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        documentId: "other-doc",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
      },
    });

    await cancelActiveDocumentConvertTasks(TEST_USER_ID, TEST_DOC_ID);

    expect((await db.asyncTask.findUnique({ where: { id: relationalMatch.id } }))?.status).toBe("cancel_requested");
    expect((await db.asyncTask.findUnique({ where: { id: legacyConflict.id } }))?.status).toBe("running");
  });

  it("does not match similar IDs or unrelated payload fields", async () => {
    const similar = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        inputData: JSON.stringify({ docId: `${TEST_DOC_ID}-longer` }),
      },
    });
    const unrelated = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        inputData: JSON.stringify({ note: TEST_DOC_ID, docId: "other-doc" }),
      },
    });

    await cancelActiveDocumentConvertTasks(TEST_USER_ID, TEST_DOC_ID);

    expect((await db.asyncTask.findUnique({ where: { id: similar.id } }))?.status).toBe("running");
    expect((await db.asyncTask.findUnique({ where: { id: unrelated.id } }))?.status).toBe("running");
  });

  it("identifies only the newest conversion task for a document as current", async () => {
    const sameCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const oldTask = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "running",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
        createdAt: sameCreatedAt,
      },
    });
    const newTask = await db.asyncTask.create({
      data: {
        userId: TEST_USER_ID,
        type: "document_convert",
        status: "pending",
        inputData: JSON.stringify({ docId: TEST_DOC_ID }),
        createdAt: sameCreatedAt,
      },
    });

    await expect(isLatestDocumentConvertTask(TEST_USER_ID, TEST_DOC_ID, oldTask.id)).resolves.toBe(false);
    await expect(isLatestDocumentConvertTask(TEST_USER_ID, TEST_DOC_ID, newTask.id)).resolves.toBe(true);
  });
});

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
type TimingTask = Parameters<typeof aggregateDocumentProcessingTiming>[0][number];

function timingTask(overrides: Partial<TimingTask> & Pick<TimingTask, "id" | "type">): TimingTask {
  return {
    id: overrides.id,
    type: overrides.type,
    status: overrides.status ?? "completed",
    progress: overrides.progress ?? 100,
    operationId: "operationId" in overrides ? overrides.operationId! : "operation-latest",
    attempt: overrides.attempt ?? 0,
    inputData: overrides.inputData ?? null,
    startedAt: "startedAt" in overrides ? overrides.startedAt! : new Date("2026-01-01T00:00:00.000Z"),
    finishedAt: "finishedAt" in overrides ? overrides.finishedAt! : new Date("2026-01-01T00:00:10.000Z"),
    parentTaskId: "parentTaskId" in overrides ? overrides.parentTaskId! : null,
    resultData: "resultData" in overrides ? overrides.resultData! : null,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
  };
}

function convertInput(mode: "standard" | "graph" | "wiki" | "full"): string {
  return JSON.stringify({
    options: {
      indexMode: mode === "graph" || mode === "full" ? "graph" : "basic",
      wikiEnabled: mode === "wiki" || mode === "full",
      indexTarget: "full",
    },
  });
}

describe("aggregateDocumentProcessingTiming", () => {
  it.each([
    ["standard", 20_000],
    ["graph", 30_000],
    ["wiki", 40_000],
    ["full", 40_000],
  ] as const)("covers every required %s stage through the latest finish", (mode, expectedDuration) => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({
        id: "convert",
        type: "document_convert",
        inputData: convertInput(mode),
        finishedAt: new Date("2026-01-01T00:00:05.000Z"),
      }),
      timingTask({ id: "embed", type: "rag_embed_index", finishedAt: new Date("2026-01-01T00:00:20.000Z") }),
      ...(mode === "graph" || mode === "full"
        ? [timingTask({ id: "graph", type: "rag_index", finishedAt: new Date("2026-01-01T00:00:30.000Z") })]
        : []),
      ...(mode === "wiki" || mode === "full"
        ? [
            timingTask({ id: "segment", type: "document_segment", finishedAt: new Date("2026-01-01T00:00:35.000Z") }),
            timingTask({ id: "wiki", type: "wiki_synthesize", finishedAt: new Date("2026-01-01T00:00:40.000Z") }),
          ]
        : []),
    ]);

    expect(result.processingStartedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.processingDurationMs).toBe(expectedDuration);
  });

  it("isolates the latest convert operation", () => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({
        id: "old-convert",
        type: "document_convert",
        operationId: "operation-old",
        inputData: convertInput("standard"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      timingTask({
        id: "latest-convert",
        type: "document_convert",
        inputData: convertInput("standard"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        startedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
      timingTask({
        id: "latest-embed",
        type: "rag_embed_index",
        createdAt: new Date("2026-01-02T00:00:01.000Z"),
        finishedAt: new Date("2026-01-02T00:00:20.000Z"),
      }),
      timingTask({
        id: "other-operation-graph",
        type: "rag_index",
        operationId: "operation-other",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        finishedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
    ]);

    expect(result.processingStartedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(result.processingDurationMs).toBe(20_000);
  });

  it("isolates legacy null-operation tasks to the latest convert round", () => {
    const oldConvert = timingTask({
      id: "old-convert",
      type: "document_convert",
      operationId: null,
      inputData: convertInput("standard"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const oldEmbed = timingTask({
      id: "old-embed",
      type: "rag_embed_index",
      operationId: null,
      parentTaskId: oldConvert.id,
      createdAt: new Date("2026-01-01T00:01:00.000Z"),
      finishedAt: new Date("2026-01-01T00:02:00.000Z"),
    });
    const latestConvert = timingTask({
      id: "latest-convert",
      type: "document_convert",
      operationId: null,
      inputData: convertInput("standard"),
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      startedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    const round = selectLatestDocumentProcessingRound([oldConvert, oldEmbed, latestConvert]);
    const result = aggregateDocumentProcessingTiming([oldConvert, oldEmbed, latestConvert]);

    expect(round.map((task) => task.id)).toEqual([latestConvert.id]);
    expect(result.processingStartedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(result.processingDurationMs).toBeNull();
  });

  it("includes a legacy null-operation task without lineage inside the latest time window", () => {
    const latestConvert = timingTask({
      id: "latest-convert",
      type: "document_convert",
      operationId: null,
      inputData: convertInput("standard"),
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const legacyEmbed = timingTask({
      id: "legacy-embed",
      type: "rag_embed_index",
      operationId: null,
      parentTaskId: null,
      createdAt: new Date("2026-01-02T00:00:01.000Z"),
      finishedAt: new Date("2026-01-02T00:00:20.000Z"),
    });

    expect(selectLatestDocumentProcessingRound([latestConvert, legacyEmbed]).map((task) => task.id))
      .toEqual([latestConvert.id, legacyEmbed.id]);
  });

  it("uses lineage to exclude unrelated null-operation tasks inside the latest time window", () => {
    const latestConvert = timingTask({
      id: "latest-convert",
      type: "document_convert",
      operationId: null,
      inputData: convertInput("standard"),
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const unrelatedEmbed = timingTask({
      id: "unrelated-embed",
      type: "rag_embed_index",
      operationId: null,
      parentTaskId: "other-convert",
      createdAt: new Date("2026-01-02T00:00:01.000Z"),
      finishedAt: new Date("2026-01-02T00:00:20.000Z"),
    });

    expect(selectLatestDocumentProcessingRound([latestConvert, unrelatedEmbed]).map((task) => task.id))
      .toEqual([latestConvert.id]);
  });

  it.each(["pending", "running", "cancel_requested"])(
    "keeps the start timestamp but no duration while a required task is %s",
    (status) => {
      const result = aggregateDocumentProcessingTiming([
        timingTask({ id: "convert", type: "document_convert", inputData: convertInput("standard") }),
        timingTask({ id: "embed", type: "rag_embed_index", status, finishedAt: null }),
      ]);

      expect(result.processingStartedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result.processingDurationMs).toBeNull();
    },
  );

  it("keeps pending tasks without startedAt at a null start", () => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({
        id: "convert",
        type: "document_convert",
        status: "pending",
        inputData: convertInput("standard"),
        startedAt: null,
        finishedAt: null,
      }),
    ]);

    expect(result.processingStartedAt).toBeNull();
    expect(result.processingDurationMs).toBeNull();
  });

  it("falls back to createdAt for a terminal legacy convert without startedAt", () => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({
        id: "convert",
        type: "document_convert",
        inputData: convertInput("standard"),
        startedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:05.000Z"),
      }),
      timingTask({ id: "embed", type: "rag_embed_index", finishedAt: new Date("2026-01-01T00:00:20.000Z") }),
    ]);

    expect(result.processingStartedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.processingDurationMs).toBe(20_000);
  });

  it.each(TERMINAL_STATUSES)("accepts %s as a terminal required-task result", (status) => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({ id: "convert", type: "document_convert", inputData: convertInput("standard") }),
      timingTask({
        id: "embed",
        type: "rag_embed_index",
        status,
        finishedAt: new Date("2026-01-01T00:00:20.000Z"),
      }),
    ]);

    expect(result.processingDurationMs).toBe(20_000);
  });

  it("uses actual graph and wiki tasks as mode backstops when convert options say standard", () => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({ id: "convert", type: "document_convert", inputData: convertInput("standard") }),
      timingTask({ id: "embed", type: "rag_embed_index", finishedAt: new Date("2026-01-01T00:00:20.000Z") }),
      timingTask({ id: "graph", type: "rag_index", status: "running", finishedAt: null }),
      timingTask({ id: "segment", type: "document_segment", finishedAt: new Date("2026-01-01T00:00:30.000Z") }),
      timingTask({ id: "wiki", type: "wiki_synthesize", finishedAt: new Date("2026-01-01T00:00:40.000Z") }),
    ]);

    expect(result.processingDurationMs).toBeNull();
  });

  it("keeps processing timing null while the durable graph retry is pending", () => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({ id: "convert", type: "document_convert", inputData: convertInput("graph") }),
      timingTask({ id: "embed", type: "rag_embed_index", finishedAt: new Date("2026-01-01T00:00:20.000Z") }),
      timingTask({
        id: "graph-attempt-0",
        type: "rag_index",
        status: "cancelled",
        attempt: 0,
        resultData: JSON.stringify({ graphStatus: "retrying", retryTaskId: "graph-attempt-1" }),
        finishedAt: new Date("2026-01-01T00:00:25.000Z"),
      }),
      timingTask({
        id: "graph-attempt-1",
        type: "rag_index",
        status: "pending",
        attempt: 1,
        parentTaskId: "graph-attempt-0",
        startedAt: null,
        finishedAt: null,
        createdAt: new Date("2026-01-01T00:00:25.000Z"),
      }),
    ]);

    expect(result.processingDurationMs).toBeNull();
  });

  it("does not let an orphaned legacy retryScheduled marker block timing forever", () => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({ id: "convert", type: "document_convert", inputData: convertInput("graph") }),
      timingTask({ id: "embed", type: "rag_embed_index", finishedAt: new Date("2026-01-01T00:00:20.000Z") }),
      timingTask({
        id: "graph-attempt-0",
        type: "rag_index",
        status: "cancelled",
        attempt: 0,
        resultData: JSON.stringify({ graphStatus: "retrying", retryScheduled: true, nextAttempt: 1 }),
        finishedAt: new Date("2026-01-01T00:00:25.000Z"),
      }),
    ]);

    expect(result.processingDurationMs).toBe(25_000);
  });

  it("waits for the highest graph attempt instead of an earlier cancelled retry", () => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({ id: "convert", type: "document_convert", inputData: convertInput("graph") }),
      timingTask({ id: "embed", type: "rag_embed_index", finishedAt: new Date("2026-01-01T00:00:20.000Z") }),
      timingTask({
        id: "graph-attempt-0",
        type: "rag_index",
        status: "cancelled",
        attempt: 0,
        finishedAt: new Date("2026-01-01T00:00:25.000Z"),
      }),
      timingTask({
        id: "graph-attempt-1",
        type: "rag_index",
        status: "running",
        attempt: 1,
        startedAt: new Date("2026-01-01T00:00:26.000Z"),
        finishedAt: null,
      }),
    ]);

    expect(result.processingDurationMs).toBeNull();
    expect(result.processingStartedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("ends at the highest completed graph attempt", () => {
    const result = aggregateDocumentProcessingTiming([
      timingTask({ id: "convert", type: "document_convert", inputData: convertInput("graph") }),
      timingTask({ id: "embed", type: "rag_embed_index", finishedAt: new Date("2026-01-01T00:00:20.000Z") }),
      timingTask({
        id: "graph-attempt-0",
        type: "rag_index",
        status: "cancelled",
        attempt: 0,
        finishedAt: new Date("2026-01-01T00:00:25.000Z"),
      }),
      timingTask({
        id: "graph-attempt-1",
        type: "rag_index",
        attempt: 1,
        finishedAt: new Date("2026-01-01T00:00:45.000Z"),
      }),
    ]);

    expect(result.processingDurationMs).toBe(45_000);
  });
});
