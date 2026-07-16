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
  const rows = [...relational, ...legacy].sort((a, b) => {
    const delta = a.createdAt.getTime() - b.createdAt.getTime();
    return input.order === "asc" ? delta : -delta;
  });
  return input.take === undefined ? rows : rows.slice(0, input.take);
}

export async function findTaskIdsByResourceIdentity(
  input: FindTasksByResourceIdentityInput,
): Promise<string[]> {
  return (await findTasksByResourceIdentity(input)).map((row) => row.id);
}

export async function cancelTasksByResourceIdentity(
  input: FindTasksByResourceIdentityInput & { errorMessage: string },
): Promise<number> {
  const ids = await findTaskIdsByResourceIdentity(input);
  if (ids.length === 0) return 0;
  const updated = await db.asyncTask.updateMany({
    where: { id: { in: ids }, status: { in: input.statuses ?? ["pending", "running"] } },
    data: { status: "cancelled", errorMessage: input.errorMessage },
  });
  return updated.count;
}
