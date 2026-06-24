import { NextResponse } from "next/server";

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
  | "conflict";

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
