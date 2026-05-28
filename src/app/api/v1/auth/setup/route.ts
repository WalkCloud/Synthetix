import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { setAuthCookies } from "@/lib/auth/session";
import { errorResponse, successResponse } from "@/lib/api-helpers";
import type { AuthUser } from "@/types/auth";

const setupSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  displayName: z.string().max(100).optional(),
});

export async function POST(
  request: Request
) {
  try {
    const userCount = await db.user.count();
    if (userCount > 0) {
      return errorResponse("System is already initialized", 400);
    }

    const body = await request.json();
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return errorResponse(firstError?.message ?? "Invalid input", 400);
    }

    const { username, password } = parsed.data;

    const passwordHash = await hashPassword(password);
    const user = await db.user.create({
      data: {
        username,
        passwordHash,
        displayName: parsed.data.displayName || username,
        role: "admin",
      },
    });

    const jwtPayload = {
      userId: user.id,
      username: user.username,
      role: user.role as "admin" | "user",
    };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(jwtPayload),
      signRefreshToken(jwtPayload),
    ]);

    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role as "admin" | "user",
    };

    const response = successResponse(authUser, 201);

    await setAuthCookies(response, accessToken, refreshToken);

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
