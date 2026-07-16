import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { parseTaskInput } from "@/lib/queue/task-json";
import type {
  SubmitTaskOptions,
  TaskIdentity,
  TaskPayload,
  TaskResourceIdentity,
  TaskType,
} from "./types";

const DOCUMENT_TASK_TYPES = new Set<TaskType>([
  "document_convert",
  "document_cleanup",
  "document_segment",
  "rag_embed_index",
  "rag_index",
  "wiki_synthesize",
]);

const ALLOWED_PARENT_TYPES: Partial<Record<TaskType, readonly TaskType[]>> = {
  rag_embed_index: ["document_convert"],
  document_segment: ["rag_embed_index"],
  rag_index: ["rag_embed_index", "rag_index"],
  wiki_synthesize: ["document_segment"],
};

export class InvalidTaskIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskIdentityError";
  }
}

function optionalIdentifier(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function inferTaskResourceIdentity(
  type: TaskType,
  payload: TaskPayload,
): TaskResourceIdentity {
  const identity: TaskResourceIdentity = {
    documentId: optionalIdentifier(payload.docId),
    draftId: optionalIdentifier(payload.draftId),
    sectionId: optionalIdentifier(payload.sectionId),
    sessionId: optionalIdentifier(payload.sessionId),
  };

  if (type.startsWith("_test_")) return identity;

  if (DOCUMENT_TASK_TYPES.has(type)) {
    if (!identity.documentId) {
      throw new InvalidTaskIdentityError(`Task ${type} requires docId`);
    }
    if (identity.draftId || identity.sectionId || identity.sessionId) {
      throw new InvalidTaskIdentityError(`Task ${type} accepts only document identity`);
    }
    return identity;
  }

  if (type === "outline_generate") {
    if (!identity.sessionId) {
      throw new InvalidTaskIdentityError("Task outline_generate requires sessionId");
    }
    if (identity.documentId || identity.draftId || identity.sectionId) {
      throw new InvalidTaskIdentityError("Task outline_generate accepts only session identity");
    }
    return identity;
  }

  if (type === "draft_generate_all") {
    if (!identity.draftId) {
      throw new InvalidTaskIdentityError("Task draft_generate_all requires draftId");
    }
    if (identity.documentId || identity.sectionId || identity.sessionId) {
      throw new InvalidTaskIdentityError("Task draft_generate_all accepts only draft identity");
    }
    return identity;
  }

  throw new InvalidTaskIdentityError(`Unsupported task type: ${type}`);
}

function legacyResourceIdentity(type: TaskType, inputData: string | null): TaskResourceIdentity {
  return inferTaskResourceIdentity(type, parseTaskInput<TaskPayload>(inputData, {}));
}

function legacyAttempt(type: TaskType, inputData: string | null): number {
  if (type !== "rag_index") return 0;
  const input = parseTaskInput<{ options?: Record<string, unknown> }>(inputData, {});
  const attempt = input.options?._graphAttempt;
  return typeof attempt === "number" && Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
}

function assertMatchingResource(
  child: TaskResourceIdentity,
  parent: TaskResourceIdentity,
): void {
  for (const field of ["documentId", "draftId", "sectionId", "sessionId"] as const) {
    if (child[field] !== parent[field]) {
      throw new InvalidTaskIdentityError(`Child ${field} does not match parent task`);
    }
  }
}

export async function resolveTaskIdentity(input: {
  type: TaskType;
  payload: TaskPayload;
  userId: string;
  options?: SubmitTaskOptions;
}): Promise<TaskIdentity> {
  const resource = inferTaskResourceIdentity(input.type, input.payload);
  const options = input.options ?? {};

  if (!options.parentTaskId) {
    if (options.attempt !== undefined && options.attempt !== 0) {
      throw new InvalidTaskIdentityError("Top-level task attempt must be 0");
    }
    return {
      ...resource,
      operationId: options.operationId ?? uuidv4(),
      parentTaskId: null,
      attempt: 0,
    };
  }

  const parent = await db.asyncTask.findUnique({
    where: { id: options.parentTaskId },
    select: {
      id: true,
      userId: true,
      type: true,
      inputData: true,
      documentId: true,
      draftId: true,
      sectionId: true,
      sessionId: true,
      operationId: true,
      attempt: true,
    },
  });
  if (!parent || parent.userId !== input.userId) {
    throw new InvalidTaskIdentityError("Parent task was not found for this user");
  }
  const parentType = parent.type as TaskType;
  const allowedParents = ALLOWED_PARENT_TYPES[input.type];
  if (!input.type.startsWith("_test_") && !allowedParents?.includes(parentType)) {
    throw new InvalidTaskIdentityError(`Task ${input.type} cannot follow ${parentType}`);
  }

  const relationalParent: TaskResourceIdentity = {
    documentId: parent.documentId,
    draftId: parent.draftId,
    sectionId: parent.sectionId,
    sessionId: parent.sessionId,
  };
  const hasRelationalResource = Object.values(relationalParent).some((value) => value !== null);
  const parentResource = hasRelationalResource
    ? relationalParent
    : legacyResourceIdentity(parentType, parent.inputData);
  assertMatchingResource(resource, parentResource);

  const operationId = parent.operationId ?? uuidv4();
  const parentAttempt = parent.attempt ?? legacyAttempt(parentType, parent.inputData);
  if (!parent.operationId || parent.attempt === null || !hasRelationalResource) {
    const upgraded = await db.asyncTask.updateMany({
      where: { id: parent.id, userId: input.userId },
      data: {
        ...parentResource,
        operationId,
        attempt: parentAttempt,
      },
    });
    if (upgraded.count !== 1) {
      throw new InvalidTaskIdentityError("Parent task could not be upgraded");
    }
  }
  if (options.operationId && options.operationId !== operationId) {
    throw new InvalidTaskIdentityError("Child operationId conflicts with parent task");
  }

  const isGraphRetry = input.type === "rag_index" && parentType === "rag_index";
  const attempt = isGraphRetry ? parentAttempt + 1 : 0;
  if (options.attempt !== undefined && options.attempt !== attempt) {
    throw new InvalidTaskIdentityError("Child attempt conflicts with parent task");
  }

  return {
    ...resource,
    operationId,
    parentTaskId: parent.id,
    attempt,
  };
}
