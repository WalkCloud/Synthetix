import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import type { AuthUser } from "@/types/auth";

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

export async function authOrError(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export function authErrorResponse() {
  return NextResponse.json(
    { success: false, error: "Unauthorized" },
    { status: 401 }
  );
}

export function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { success: false, error: getErrorMessage(error) },
    { status }
  );
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
