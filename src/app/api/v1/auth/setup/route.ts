import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { setAuthCookies } from "@/lib/auth/session";
import { getClientIp, setupIpRateLimiter } from "@/lib/auth/rate-limit";
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
  const ip = getClientIp(request);
  const limit = setupIpRateLimiter.check(ip);
  if (!limit.allowed) {
    const response = errorResponse({ code: "invalidInput", message: "Too many requests" }, 429);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  try {
    const userCount = await db.user.count();
    if (userCount > 0) {
      setupIpRateLimiter.recordFailure(ip);
      return errorResponse({ code: "conflict", message: "System is already initialized" }, 400);
    }

    const body = await request.json();
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      setupIpRateLimiter.recordFailure(ip);
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
    setupIpRateLimiter.clear(ip);

    return response;
  } catch (error) {
    setupIpRateLimiter.recordFailure(ip);
    return errorResponse(error);
  }
}
