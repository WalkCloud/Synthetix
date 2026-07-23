import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { AuthUser } from "@/types/auth";

/** Stable error codes that map to frontend t.errors.* keys */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "serverError"
  | "draftNotFound"
  | "sectionNotFound"
  | "documentNotFound"
  | "modelNotConfigured"
  | "ragNotConfigured"
  | "generationFailed"
  | "exportFailed"
  | "uploadFailed"
  | "noFileProvided"
  | "fileEmpty"
  | "fileTooLarge"
  | "unsupportedFormat"
  | "passwordIncorrect"
  | "batchDeleteFailed"
  | "invalidInput"
  | "conflict"
  | "apiKeyNotFound"
  | "apiKeyNameRequired"
  | "apiKeyAlreadyRevoked";

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

export function authErrorResponse() {
  return NextResponse.json(
    { success: false, error: "Unauthorized", code: "unauthorized" as ErrorCode },
    { status: 401 }
  );
}

/**
 * Return a JSON error response.
 *
 * Supports two calling conventions:
 * 1. Legacy string: errorResponse("Something went wrong", 500)
 * 2. Coded: errorResponse({ code: "notFound", message: "Draft abc not found" }, 404)
 *
 * When a `code` is provided, the client-side `getLocalizedError()` helper
 * can map it to a user-facing localized string via `t.errors[code]`.
 */
export function errorResponse(
  error: unknown,
  status = 500,
): NextResponse<{
  success: false;
  error: string;
  code?: ErrorCode;
  details?: string;
}> {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code, message, details } = error as {
      code: ErrorCode;
      message?: string;
      details?: string;
    };
    return NextResponse.json(
      {
        success: false,
        error: message || code,
        code,
        ...(details ? { details } : {}),
      },
      { status }
    );
  }

  return NextResponse.json(
    { success: false, error: getErrorMessage(error) },
    { status }
  );
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

// ─── Route precondition helpers ─────────────────────────────────────────────
// These helpers centralise the auth + ownership checks repeated across draft
// section routes. Each returns either the loaded entity or an error Response;
// callers check `instanceof Response` to short-circuit (design §4.2).

/**
 * Authenticate the request. Returns the user on success, or a 401 Response
 * if no valid session exists.
 *
 * Usage:
 *   const auth = await requireAuthUser();
 *   if (auth instanceof Response) return auth;
 *   const { user } = auth;
 */
export async function requireAuthUser(): Promise<{ user: AuthUser } | Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();
  return { user };
}

/**
 * Load a draft owned by `userId`. Returns the draft (with optional `select`
 * projection) or a 404 Response if not found.
 *
 * The type parameter `T` controls what the caller sees. Omit it to get the
 * full Draft row, or pass a partial type when using `select`.
 *
 * Usage:
 *   const draft = await loadOwnedDraft(draftId, user.id);
 *   if (draft instanceof Response) return draft;
 *   // draft is now typed as the full Draft row
 */
export async function loadOwnedDraft<T = NonNullable<Awaited<ReturnType<typeof db.draft.findFirst>>>>(
  draftId: string,
  userId: string,
  select?: Record<string, true>,
): Promise<T | Response> {
  const draft = await db.draft.findFirst({
    where: { id: draftId, userId },
    ...(select ? { select } : {}),
  });
  if (!draft) {
    return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
  }
  return draft as unknown as T;
}

/**
 * Load a section within a draft. Returns the section (with optional `include`
 * relations) or a 404 Response if not found.
 *
 * Usage:
 *   const section = await loadSectionInDraft(sectionId, draftId);
 *   if (section instanceof Response) return section;
 */
export async function loadSectionInDraft<T = NonNullable<Awaited<ReturnType<typeof db.section.findFirst>>>>(
  sectionId: string,
  draftId: string,
  include?: Record<string, true>,
): Promise<T | Response> {
  const section = await db.section.findFirst({
    where: { id: sectionId, draftId },
    ...(include ? { include } : {}),
  });
  if (!section) {
    return errorResponse({ code: "sectionNotFound", message: "Section not found" }, 404);
  }
  return section as unknown as T;
}
