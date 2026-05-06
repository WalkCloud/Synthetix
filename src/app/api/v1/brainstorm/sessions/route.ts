import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";

export async function GET(): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const sessions = await db.brainstormSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });

  return NextResponse.json({ success: true, data: sessions });
}

export async function POST(request: Request): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { title } = await request.json();
  if (!title || typeof title !== "string") {
    return NextResponse.json({ success: false, error: "Title required" }, { status: 400 });
  }

  const session = await db.brainstormSession.create({
    data: { userId: user.id, title, status: "active" },
  });

  await db.message.create({
    data: { sessionId: session.id, role: "system", content: "新的头脑风暴会话已创建。请描述您的文档写作需求。" },
  });

  return NextResponse.json({ success: true, data: session }, { status: 201 });
}
