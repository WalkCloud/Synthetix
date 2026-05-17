import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

import { getErrorMessage } from "@/lib/api-helpers";

const STUCK_THRESHOLD_MS = 3 * 60 * 1000;
const TRANSIENT_STATUSES = ["generating", "retrieving", "comparing"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    let draft = await db.draft.findFirst({
      where: { id, userId: user.id },
      include: {
        sections: {
          orderBy: { index: "asc" },
        },
      },
    });

    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 }
      );
    }

    const now = Date.now();
    const stuckSectionIds = draft.sections
      .filter((s) => {
        if (!TRANSIENT_STATUSES.includes(s.status)) return false;
        const elapsed = now - new Date(s.updatedAt).getTime();
        return elapsed > STUCK_THRESHOLD_MS;
      })
      .map((s) => s.id);

    if (stuckSectionIds.length > 0) {
      await db.section.updateMany({
        where: { id: { in: stuckSectionIds } },
        data: { status: "failed" },
      });
      const refreshed = await db.draft.findFirst({
        where: { id, userId: user.id },
        include: { sections: { orderBy: { index: "asc" } } },
      });
      if (refreshed) draft = refreshed;
    }

    return NextResponse.json({ success: true, data: draft });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    const draft = await db.draft.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 }
      );
    }

    // Cascade delete: SectionVersion -> Section -> Draft
    // Prisma onDelete: Cascade handles SectionVersion and Section automatically
    await db.draft.delete({ where: { id: draft.id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
