import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { outline } = body;

  if (!outline) {
    return NextResponse.json({ success: false, error: "outline required" }, { status: 400 });
  }

  try {
    const session = await db.brainstormSession.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!session) {
      return NextResponse.json({ success: false, error: "Session not found" }, { status: 404 });
    }

    await db.brainstormSession.update({
      where: { id },
      data: { outline: JSON.stringify(outline) },
    });

    return NextResponse.json({ success: true, data: { saved: true } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
