import type { TaskType, WorkerResult } from "./types";

const DEFAULT_MUTATION_TIMEOUT_MS = 30_000;

interface ActiveExecution {
  taskId: string;
  taskType: TaskType;
  userId?: string;
  docId?: string;
  settled: Promise<void>;
}

interface GateWaiter {
  promise: Promise<void>;
  resolve: () => void;
}

export class DocumentMutationBusyError extends Error {
  readonly code = "DOCUMENT_MUTATION_BUSY";
  readonly retryable = true;

  constructor(readonly docIds: readonly string[]) {
    super(`Document processing is still active for: ${docIds.join(", ")}`);
    this.name = "DocumentMutationBusyError";
  }
}

function documentKey(userId: string, docId: string): string {
  return `${userId}\0${docId}`;
}

export class ExecutionRegistry {
  private coordination = Promise.resolve();
  private readonly activeByTask = new Map<string, ActiveExecution>();
  private readonly taskIdsByDocument = new Map<string, Set<string>>();
  private readonly mutationGates = new Set<string>();
  private readonly gateWaiters = new Map<string, GateWaiter>();

  private async exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = this.coordination;
    let release: () => void = () => {};
    this.coordination = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private waiterFor(key: string): GateWaiter {
    const current = this.gateWaiters.get(key);
    if (current) return current;
    let resolve: () => void = () => {};
    const waiter = {
      promise: new Promise<void>((done) => { resolve = done; }),
      resolve,
    };
    this.gateWaiters.set(key, waiter);
    return waiter;
  }

  async startExecution(input: {
    taskId: string;
    taskType: TaskType;
    userId?: string;
    docId?: string;
    start: () => Promise<WorkerResult>;
  }): Promise<{ workerPromise: Promise<WorkerResult> }> {
    const key = input.userId && input.docId ? documentKey(input.userId, input.docId) : null;

    while (true) {
      const started = await this.exclusive(() => {
        if (key && this.mutationGates.has(key)) {
          return { wait: this.waiterFor(key).promise } as const;
        }

        const workerPromise = input.start();
        const settled = workerPromise.then(
          () => undefined,
          () => undefined,
        );
        const execution: ActiveExecution = {
          taskId: input.taskId,
          taskType: input.taskType,
          userId: input.userId,
          docId: input.docId,
          settled,
        };
        this.activeByTask.set(input.taskId, execution);
        if (key) {
          const taskIds = this.taskIdsByDocument.get(key) ?? new Set<string>();
          taskIds.add(input.taskId);
          this.taskIdsByDocument.set(key, taskIds);
        }

        void settled.then(() => this.unregister(input.taskId));
        return { workerPromise } as const;
      });

      if ("workerPromise" in started && started.workerPromise) {
        return { workerPromise: started.workerPromise };
      }
      if ("wait" in started) await started.wait;
    }
  }

  async startDocumentExecution(input: {
    taskId: string;
    taskType: TaskType;
    userId: string;
    docId: string;
    start: () => Promise<WorkerResult>;
  }): Promise<Promise<WorkerResult>> {
    return (await this.startExecution(input)).workerPromise;
  }

  private async unregister(taskId: string): Promise<void> {
    await this.exclusive(() => {
      const execution = this.activeByTask.get(taskId);
      if (!execution) return;
      this.activeByTask.delete(taskId);
      if (execution.userId && execution.docId) {
        const key = documentKey(execution.userId, execution.docId);
        const taskIds = this.taskIdsByDocument.get(key);
        taskIds?.delete(taskId);
        if (taskIds?.size === 0) this.taskIdsByDocument.delete(key);
      }
    });
  }

  async awaitTaskExecutions(
    taskIds: readonly string[],
    options: { timeoutMs?: number } = {},
  ): Promise<void> {
    const normalized = [...new Set(taskIds)].sort();
    const executions = await this.exclusive(() => normalized
      .map((taskId) => this.activeByTask.get(taskId)?.settled)
      .filter((settled): settled is Promise<void> => !!settled));
    if (executions.length === 0) return;

    const timeoutMs = options.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(executions),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Task execution did not settle before timeout: ${normalized.join(", ")}`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async awaitDocumentExecutions(
    userId: string,
    docIds: readonly string[],
    options: { excludeTaskId?: string; timeoutMs?: number } = {},
  ): Promise<void> {
    const normalized = [...new Set(docIds)].sort();
    const taskIds = await this.exclusive(() => normalized.flatMap((docId) => {
      const documentTaskIds = this.taskIdsByDocument.get(documentKey(userId, docId));
      if (!documentTaskIds) return [];
      return [...documentTaskIds].filter((taskId) => taskId !== options.excludeTaskId);
    }));
    try {
      await this.awaitTaskExecutions(taskIds, options);
    } catch {
      throw new DocumentMutationBusyError(normalized);
    }
  }

  async withDocumentMutation<T>(
    userId: string,
    docIds: readonly string[],
    mutate: () => Promise<T>,
  ): Promise<T> {
    const normalized = [...new Set(docIds)].sort();
    const keys = normalized.map((docId) => documentKey(userId, docId));

    while (true) {
      const acquired = await this.exclusive(() => {
        const blocked = keys.find((key) => this.mutationGates.has(key));
        if (blocked) return { wait: this.waiterFor(blocked).promise } as const;
        for (const key of keys) this.mutationGates.add(key);
        return { acquired: true } as const;
      });
      if ("acquired" in acquired) break;
      await acquired.wait;
    }

    try {
      return await mutate();
    } finally {
      await this.exclusive(() => {
        for (const key of keys) {
          this.mutationGates.delete(key);
          const waiter = this.gateWaiters.get(key);
          this.gateWaiters.delete(key);
          waiter?.resolve();
        }
      });
    }
  }

  async hasActiveExecution(userId: string, docId: string): Promise<boolean> {
    return this.exclusive(() => (this.taskIdsByDocument.get(documentKey(userId, docId))?.size ?? 0) > 0);
  }
}

export const executionRegistry = new ExecutionRegistry();
