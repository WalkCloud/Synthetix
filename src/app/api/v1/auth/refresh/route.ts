import { NextResponse } from "next/server";
import { refreshSession, setAuthCookies } from "@/lib/auth/session";
import { errorResponse, successResponse } from "@/lib/api-helpers";
import type { AuthUser } from "@/types/auth";

export async function POST() {
  try {
    const result = await refreshSession();
    if (!result) {
      return errorResponse("Invalid or expired refresh token", 401);
    }

    const { accessToken, refreshToken, user } = result;
    const response = successResponse(user);
    await setAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
