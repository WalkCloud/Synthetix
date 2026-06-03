import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return errorResponse({ code: "notFound", message: "User not found" }, 404);

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
  email: z.string().trim().email("emailInvalid").optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
});

export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    const hasEmailError = parsed.error.issues.some((issue) => issue.path[0] === "email");
    if (hasEmailError) {
      return errorResponse({ code: "invalidInput", message: "emailInvalid" }, 400);
    }
    return errorResponse({ code: "invalidInput", message: "Invalid profile input" }, 400);
  }

  let updated;
  try {
    updated = await db.user.update({
      where: { id: user.id },
      data: parsed.data,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return errorResponse({ code: "invalidInput", message: "emailAlreadyUsed" }, 400);
    }
    throw error;
  }

  return successResponse({
    id: updated.id,
    username: updated.username,
    email: updated.email,
    displayName: updated.displayName,
  });
}
