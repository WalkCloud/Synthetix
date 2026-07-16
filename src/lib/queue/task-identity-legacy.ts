export interface LegacyTaskIdentity {
  documentId: string | null;
  draftId: string | null;
  sectionId: string | null;
  sessionId: string | null;
  attempt: number | null;
}

export type LegacyTaskIdentityParseStatus = "parsed" | "null" | "malformed" | "ambiguous";

export interface LegacyTaskIdentityParseResult {
  status: LegacyTaskIdentityParseStatus;
  identity: LegacyTaskIdentity;
  issues: string[];
}

export interface TaskIdentityShadowRow {
  type: string;
  inputData: string | null;
  documentId: string | null;
  draftId: string | null;
  sectionId: string | null;
  sessionId: string | null;
  attempt: number | null;
}

export interface TaskIdentityMismatch {
  field: keyof LegacyTaskIdentity;
  relational: string | number;
  legacy: string | number;
}

export interface TaskIdentityShadowComparison {
  authoritative: LegacyTaskIdentity;
  legacy: LegacyTaskIdentityParseResult;
  mismatches: TaskIdentityMismatch[];
}

const DOCUMENT_TASK_TYPES = new Set([
  "document_convert",
  "document_cleanup",
  "document_segment",
  "rag_embed_index",
  "rag_index",
  "wiki_synthesize",
]);

function emptyIdentity(): LegacyTaskIdentity {
  return {
    documentId: null,
    draftId: null,
    sectionId: null,
    sessionId: null,
    attempt: null,
  };
}

function parseIdentifier(
  payload: Record<string, unknown>,
  key: "docId" | "draftId" | "sectionId" | "sessionId",
): { value: string | null; malformed: boolean } {
  const value = payload[key];
  if (value === undefined || value === null || value === "") return { value: null, malformed: false };
  if (typeof value !== "string" || value.trim().length === 0) return { value: null, malformed: true };
  return { value, malformed: false };
}

export function parseLegacyTaskIdentity(input: {
  type: string;
  inputData: string | null;
}): LegacyTaskIdentityParseResult {
  const identity = emptyIdentity();
  if (!input.inputData?.trim()) return { status: "null", identity, issues: ["missing inputData"] };

  let payload: unknown;
  try {
    payload = JSON.parse(input.inputData);
  } catch {
    return { status: "malformed", identity, issues: ["invalid JSON"] };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: "malformed", identity, issues: ["inputData must be an object"] };
  }

  const data = payload as Record<string, unknown>;
  const parsed = {
    documentId: parseIdentifier(data, "docId"),
    draftId: parseIdentifier(data, "draftId"),
    sectionId: parseIdentifier(data, "sectionId"),
    sessionId: parseIdentifier(data, "sessionId"),
  };
  if (Object.values(parsed).some((entry) => entry.malformed)) {
    return { status: "malformed", identity, issues: ["identity field has an invalid value"] };
  }
  identity.documentId = parsed.documentId.value;
  identity.draftId = parsed.draftId.value;
  identity.sectionId = parsed.sectionId.value;
  identity.sessionId = parsed.sessionId.value;

  const resources = [identity.documentId, identity.draftId, identity.sectionId, identity.sessionId]
    .filter((value) => value !== null);
  if (resources.length > 1) {
    return { status: "ambiguous", identity, issues: ["multiple resource identities"] };
  }

  const isTestTask = input.type.startsWith("_test_");
  const expectedField = DOCUMENT_TASK_TYPES.has(input.type)
    ? "documentId"
    : input.type === "outline_generate"
      ? "sessionId"
      : input.type === "draft_generate_all"
        ? "draftId"
        : null;
  if (!expectedField && !isTestTask) {
    return { status: "null", identity: emptyIdentity(), issues: ["unsupported task type"] };
  }
  if (expectedField && resources.length === 1 && identity[expectedField] === null) {
    return { status: "ambiguous", identity, issues: ["resource identity conflicts with task type"] };
  }

  if (input.type === "rag_index") {
    const options = data.options;
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) {
      return { status: "malformed", identity, issues: ["options must be an object"] };
    }
    const rawAttempt = (options as Record<string, unknown> | undefined)?._graphAttempt;
    if (rawAttempt === undefined) {
      identity.attempt = 0;
    } else if (typeof rawAttempt === "number" && Number.isInteger(rawAttempt) && rawAttempt >= 0) {
      identity.attempt = rawAttempt;
    } else {
      return { status: "malformed", identity, issues: ["invalid graph attempt"] };
    }
  } else {
    identity.attempt = 0;
  }

  return { status: "parsed", identity, issues: [] };
}

export function compareTaskIdentitySources(row: TaskIdentityShadowRow): TaskIdentityShadowComparison {
  const legacy = parseLegacyTaskIdentity(row);
  const authoritative: LegacyTaskIdentity = {
    documentId: row.documentId ?? legacy.identity.documentId,
    draftId: row.draftId ?? legacy.identity.draftId,
    sectionId: row.sectionId ?? legacy.identity.sectionId,
    sessionId: row.sessionId ?? legacy.identity.sessionId,
    attempt: row.attempt ?? legacy.identity.attempt,
  };
  const mismatches: TaskIdentityMismatch[] = [];

  for (const field of ["documentId", "draftId", "sectionId", "sessionId", "attempt"] as const) {
    const relational = row[field];
    const legacyValue = legacy.identity[field];
    if (relational !== null && legacyValue !== null && relational !== legacyValue) {
      mismatches.push({ field, relational, legacy: legacyValue });
    }
  }

  return { authoritative, legacy, mismatches };
}
