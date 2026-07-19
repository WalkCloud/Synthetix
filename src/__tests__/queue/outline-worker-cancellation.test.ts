import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: {
    chat: vi.fn(),
    chatStream: vi.fn(),
  },
  db: {
    asyncTask: { updateMany: vi.fn() },
    brainstormSession: { findFirst: vi.fn(), update: vi.fn() },
    message: { create: vi.fn() },
    modelConfig: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  recordUsage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/llm/resolve-model", () => ({ resolveModel: vi.fn() }));
vi.mock("@/lib/llm/factory", () => ({ createLLMProvider: () => mocks.provider }));
vi.mock("@/lib/llm/usage", () => ({ recordTokenUsageSafely: mocks.recordUsage }));
vi.mock("@/lib/brainstorm/outline-prompt", () => ({
  buildSkeletonOutlinePrompt: () => "skeleton prompt",
  buildPartExpansionPrompt: () => "expansion prompt",
}));
vi.mock("@/lib/brainstorm/summary-prompt", () => ({ buildSummaryPrompt: () => "summary prompt" }));
vi.mock("@/lib/brainstorm/outline-normalizer", () => ({
  normalizeGeneratedOutline: (value: unknown) => value,
  fillMissingEstimatedWords: vi.fn(),
}));
vi.mock("@/lib/brainstorm/outline-markdown", () => ({
  parseMarkdownToSections: (markdown: string) => [{ num: "child", title: markdown }],
}));
vi.mock("@/lib/brainstorm/outline-quality", () => ({
  evaluateOutlineQuality: () => ({ ok: true, issues: [] }),
}));
vi.mock("@/lib/brainstorm/archetypes", () => ({ composeArchetypeKey: () => "general" }));
vi.mock("@/lib/brainstorm/messages", () => ({
  getBrainstormMessages: () => ({ outlineReady: "ready" }),
  resolveBrainstormLocale: () => "en",
}));

import { generateOutline } from "@/lib/queue/workers/outline-worker";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function streamAfter(gate: Promise<string>, signalSeen: AbortSignal[]) {
  return async function* (options: { signal: AbortSignal }) {
    signalSeen.push(options.signal);
    yield { content: await gate, inputTokens: 1, outputTokens: 1 };
  };
}

function makeContext(controller: AbortController, progress: number[]) {
  return {
    taskId: "task",
    signal: controller.signal,
    reportProgress: vi.fn(async (value: number) => { progress.push(value); }),
  };
}

const payload = {
  taskId: "task",
  sessionId: "session",
  userId: "user",
  type: "outline.generate",
  modelConfigId: "config",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.brainstormSession.findFirst.mockResolvedValue({
    title: "Session",
    messages: [{ role: "user", content: "Write a test document" }],
  });
  mocks.db.asyncTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.brainstormSession.update.mockResolvedValue({});
  mocks.db.message.create.mockResolvedValue({});
  mocks.db.$transaction.mockImplementation(async (run: (tx: typeof mocks.db) => Promise<unknown>) => run(mocks.db));
  mocks.db.modelConfig.findFirst.mockResolvedValue({
    id: "config",
    modelId: "model",
    provider: { id: "provider" },
  });
  mocks.recordUsage.mockResolvedValue(undefined);
  mocks.provider.chat.mockResolvedValue({
    content: JSON.stringify({ summary: "requirements", archetype: "general", constraints: {} }),
    inputTokens: 1,
    outputTokens: 1,
  });
});

describe("outline worker cancellation and progress", () => {
  it("passes the same AbortSignal to every provider call and advances progress when each part settles", async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const streamSignals: AbortSignal[] = [];
    const firstPart = deferred<string>();
    const secondPart = deferred<string>();

    mocks.provider.chatStream
      .mockImplementationOnce(streamAfter(Promise.resolve(JSON.stringify({
        title: "Outline",
        sections: [
          { num: "1", title: "One" },
          { num: "2", title: "Two" },
        ],
      })), streamSignals))
      .mockImplementationOnce(streamAfter(firstPart.promise, streamSignals))
      .mockImplementationOnce(streamAfter(secondPart.promise, streamSignals));

    const resultPromise = generateOutline(payload, makeContext(controller, progress) as never);
    await vi.waitFor(() => expect(mocks.provider.chatStream).toHaveBeenCalledTimes(3));

    firstPart.resolve("first expanded");
    await vi.waitFor(() => expect(progress).toContain(66));
    expect(progress).not.toContain(88);

    secondPart.resolve("second expanded");
    await expect(resultPromise).resolves.toMatchObject({ title: "Outline" });

    expect(mocks.provider.chat.mock.calls[0][0].signal).toBe(controller.signal);
    expect(streamSignals).toEqual([controller.signal, controller.signal, controller.signal]);
    expect(progress).toContain(88);
  });

  it("rethrows an expansion failure after abort instead of falling back to the original part", async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const abortError = new DOMException("cancelled", "AbortError");

    mocks.provider.chatStream
      .mockImplementationOnce(streamAfter(Promise.resolve(JSON.stringify({
        title: "Outline",
        sections: [{ num: "1", title: "One" }],
      })), []))
      .mockImplementationOnce(async function* (options: { signal: AbortSignal }) {
        expect(options.signal).toBe(controller.signal);
        controller.abort();
        throw abortError;
      });

    await expect(generateOutline(payload, makeContext(controller, progress) as never))
      .rejects.toBe(abortError);
    expect(mocks.db.brainstormSession.update).not.toHaveBeenCalled();
  });

  it("does not persist outline or ready message when cancellation wins after the final memory check", async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    mocks.provider.chatStream
      .mockImplementationOnce(streamAfter(Promise.resolve(JSON.stringify({
        title: "Outline",
        sections: [{ num: "1", title: "One" }],
      })), []))
      .mockImplementationOnce(streamAfter(Promise.resolve("expanded"), []));
    mocks.db.asyncTask.updateMany.mockImplementation(async () => {
      controller.abort();
      return { count: 0 };
    });

    await expect(generateOutline(payload, makeContext(controller, progress) as never))
      .resolves.toEqual({ cancelled: true });

    expect(mocks.db.asyncTask.updateMany).toHaveBeenCalledWith({
      where: { id: "task", status: "running" },
      data: { heartbeatAt: expect.any(Date), updatedAt: expect.any(Date) },
    });
    expect(mocks.db.brainstormSession.update).not.toHaveBeenCalled();
    expect(mocks.db.message.create).not.toHaveBeenCalled();
  });
});
