import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { ApiResponse } from "@/types/api";

interface SystemStatus {
  initialized: boolean;
}

export async function GET(): Promise<NextResponse<ApiResponse<SystemStatus>>> {
  try {
    const userCount = await db.user.count();
    return NextResponse.json({
      success: true,
      data: { initialized: userCount > 0 },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check system status";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
