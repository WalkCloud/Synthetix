import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/auth/password";

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user)
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );

  const body = await request.json();
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { currentPassword, newPassword } = parsed.data;
  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser)
    return NextResponse.json(
      { success: false, error: "User not found" },
      { status: 404 },
    );

  const valid = await verifyPassword(currentPassword, dbUser.passwordHash);
  if (!valid) {
    return NextResponse.json(
      { success: false, error: "当前密码错误" },
      { status: 400 },
    );
  }

  const newHash = await hashPassword(newPassword);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  return NextResponse.json({ success: true });
}
