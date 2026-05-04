import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { setAuthCookies } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";
import type { AuthUser } from "@/types/auth";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(
  request: Request
): Promise<NextResponse<ApiResponse<AuthUser>>> {
  try {
    // Parse and validate request body
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        {
          success: false,
          error: firstError?.message ?? "Invalid input",
        },
        { status: 400 }
      );
    }

    const { username, password } = parsed.data;

    // Find user by username or email
    const user = await db.user.findFirst({
      where: {
        OR: [{ username }, { email: username }],
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Sign JWT tokens
    const jwtPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
    };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(jwtPayload),
      signRefreshToken(jwtPayload),
    ]);

    // Build response with user data
    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };

    const response = NextResponse.json({ success: true, data: authUser });

    // Set auth cookies
    await setAuthCookies(response, accessToken, refreshToken);

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Login failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
