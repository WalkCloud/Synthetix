import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return errorResponse("User not found", 404);

  return successResponse({
    id: dbUser.id,
    username: dbUser.username,
    email: dbUser.email,
    displayName: dbUser.displayName,
    avatarUrl: dbUser.avatarUrl,
    role: dbUser.role,
    createdAt: dbUser.createdAt,
  });
}

const profileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
});

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: parsed.data,
  });

  return successResponse({
    id: updated.id,
    username: updated.username,
    displayName: updated.displayName,
  });
}
