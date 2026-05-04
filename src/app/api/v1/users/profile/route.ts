import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );

  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser)
    return NextResponse.json(
      { success: false, error: "User not found" },
      { status: 404 },
    );

  return NextResponse.json({
    success: true,
    data: {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      displayName: dbUser.displayName,
      avatarUrl: dbUser.avatarUrl,
      role: dbUser.role,
      createdAt: dbUser.createdAt,
    },
  });
}

const profileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
});

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );

  const body = await request.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: parsed.data,
  });

  return NextResponse.json({
    success: true,
    data: {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
    },
  });
}
