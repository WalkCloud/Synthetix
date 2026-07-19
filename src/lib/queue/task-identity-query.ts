import { db } from "@/lib/db";
import { compareTaskIdentitySources } from "@/lib/queue/task-identity-legacy";

export type TaskResourceIdentityField = "documentId" | "draftId" | "sectionId" | "sessionId";

export const taskIdentitySelect = {
  id: true,
  userId: true,
  type: true,
  status: true,
  progress: true,
  inputData: true,
  resultData: true,
  errorMessage: true,
  documentId: true,
  draftId: true,
  sectionId: true,
  sessionId: true,
  operationId: true,
  parentTaskId: true,
  attempt: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface FindTasksByResourceIdentityInput {
  userId: string;
  field: TaskResourceIdentityField;
  value: string;
  types?: string[];
  statuses?: string[];
  exceptTaskId?: string;
  order?: "asc" | "desc";
  take?: number;
}

export async function findTasksByResourceIdentity(input: FindTasksByResourceIdentityInput) {
  const baseWhere = {
    userId: input.userId,
    ...(input.types ? { type: { in: input.types } } : {}),
    ...(input.statuses ? { status: { in: input.statuses } } : {}),
    ...(input.exceptTaskId ? { id: { not: input.exceptTaskId } } : {}),
  };
  const relational = await db.asyncTask.findMany({
    where: { ...baseWhere, [input.field]: input.value },
    select: taskIdentitySelect,
  });
  const legacyCandidates = await db.asyncTask.findMany({
    where: { ...baseWhere, [input.field]: null },
    select: taskIdentitySelect,
  });
  const legacy = legacyCandidates.filter((row) => {
    const comparison = compareTaskIdentitySources(row);
    return comparison.authoritative[input.field] === input.value;
  });
  const rows = [...relational, ...legacy];
  const insertionOrder = await loadTaskInsertionOrder(rows.map((row) => row.id));
  rows.sort((a, b) => {
    const createdAtDelta = a.createdAt.getTime() - b.createdAt.getTime();
    const delta = createdAtDelta || (insertionOrder.get(a.id) ?? 0) - (insertionOrder.get(b.id) ?? 0);
    return input.order === "asc" ? delta : -delta;
  });
  return input.take === undefined ? rows : rows.slice(0, input.take);
}

async function loadTaskInsertionOrder(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db.$queryRawUnsafe<Array<{ id: string; rowid: number | bigint }>>(
    `SELECT id, rowid FROM async_tasks WHERE id IN (${placeholders})`,
    ...ids,
  );
  return new Map(rows.map((row) => [row.id, Number(row.rowid)]));
}

export async function findTaskIdsByResourceIdentity(
  input: FindTasksByResourceIdentityInput,
): Promise<string[]> {
  return (await findTasksByResourceIdentity(input)).map((row) => row.id);
}

export interface CancelTasksByResourceIdentityResult {
  pendingIds: string[];
  runningIds: string[];
}

export async function cancelTasksByResourceIdentity(
  input: FindTasksByResourceIdentityInput & { errorMessage: string },
): Promise<CancelTasksByResourceIdentityResult> {
  const tasks = await findTasksByResourceIdentity(input);
  const pendingIds = tasks.filter((task) => task.status === "pending").map((task) => task.id);
  const runningIds = tasks.filter((task) => task.status === "running").map((task) => task.id);
  const now = new Date();

  if (pendingIds.length > 0) {
    await db.asyncTask.updateMany({
      where: { id: { in: pendingIds }, status: "pending" },
      data: {
        status: "cancelled",
        errorMessage: input.errorMessage,
        cancelRequestedAt: now,
        finishedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      },
    });
  }
  if (runningIds.length > 0) {
    await db.asyncTask.updateMany({
      where: { id: { in: runningIds }, status: "running" },
      data: {
        status: "cancel_requested",
        errorMessage: input.errorMessage,
        cancelRequestedAt: now,
        updatedAt: now,
      },
    });
  }

  return { pendingIds, runningIds };
}
