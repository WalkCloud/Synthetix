import { NextResponse } from "next/server";
import { clearAuthCookies } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

export async function POST(): Promise<NextResponse<ApiResponse<null>>> {
  const response = NextResponse.json({
    success: true,
    data: null,
  });
  clearAuthCookies(response);
  return response;
}
