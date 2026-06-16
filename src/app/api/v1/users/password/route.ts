import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(100),
});

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json();
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { currentPassword, newPassword } = parsed.data;
  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return errorResponse({ code: "notFound", message: "User not found" }, 404);

  const valid = await verifyPassword(currentPassword, dbUser.passwordHash);
  if (!valid) {
    return errorResponse({ code: "passwordIncorrect", message: "Current password is incorrect" }, 400);
  }

  const newHash = await hashPassword(newPassword);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  return successResponse({ success: true });
}
