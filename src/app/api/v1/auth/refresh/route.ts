import { NextResponse } from "next/server";
import { refreshSession, setAuthCookies } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";
import type { AuthUser } from "@/types/auth";

export async function POST(): Promise<NextResponse<ApiResponse<AuthUser>>> {
  try {
    const result = await refreshSession();
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired refresh token" },
        { status: 401 }
      );
    }

    const { accessToken, refreshToken, user } = result;
    const response = NextResponse.json({ success: true, data: user });
    await setAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Token refresh failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
