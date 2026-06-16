import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { setAuthCookies } from "@/lib/auth/session";
import { errorResponse, successResponse } from "@/lib/api-helpers";
import type { AuthUser } from "@/types/auth";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(
  request: Request
) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return errorResponse(firstError?.message ?? "Invalid input", 400);
    }

    const { username, password } = parsed.data;

    const user = await db.user.findFirst({
      where: {
        OR: [{ username }, { email: username }],
      },
    });

    if (!user) {
      return errorResponse({ code: "unauthorized", message: "Invalid credentials" }, 401);
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return errorResponse({ code: "unauthorized", message: "Invalid credentials" }, 401);
    }

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

    const response = successResponse(authUser);

    await setAuthCookies(response, accessToken, refreshToken);

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
