import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { setAuthCookies } from "@/lib/auth/session";
import {
  getClientIp,
  loginAccountRateLimiter,
  loginIpRateLimiter,
  normalizeUsername,
} from "@/lib/auth/rate-limit";
import { errorResponse, successResponse } from "@/lib/api-helpers";
import type { AuthUser } from "@/types/auth";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const invalidCredentials = { code: "unauthorized" as const, message: "Invalid credentials" };

function rateLimitedResponse(retryAfterSeconds: number) {
  const response = errorResponse(invalidCredentials, 429);
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

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
    const normalizedUsername = normalizeUsername(username);
    const ip = getClientIp(request);
    const accountKey = `${ip}:${normalizedUsername}`;

    const accountLimit = loginAccountRateLimiter.check(accountKey);
    const ipLimit = loginIpRateLimiter.check(ip);
    if (!accountLimit.allowed || !ipLimit.allowed) {
      return rateLimitedResponse(Math.max(
        accountLimit.retryAfterSeconds,
        ipLimit.retryAfterSeconds,
      ));
    }

    const user = await db.user.findFirst({
      where: {
        OR: [{ username }, { email: username }],
      },
    });

    if (!user) {
      loginAccountRateLimiter.recordFailure(accountKey);
      loginIpRateLimiter.recordFailure(ip);
      return errorResponse(invalidCredentials, 401);
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      loginAccountRateLimiter.recordFailure(accountKey);
      loginIpRateLimiter.recordFailure(ip);
      return errorResponse(invalidCredentials, 401);
    }

    loginAccountRateLimiter.clear(accountKey);

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
