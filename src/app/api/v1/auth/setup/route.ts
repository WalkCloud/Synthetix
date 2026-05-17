import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { setAuthCookies } from "@/lib/auth/session";
import type { ApiResponse } from "@/types/api";
import type { AuthUser } from "@/types/auth";

const setupSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  displayName: z.string().min(1).max(100),
});

export async function POST(
  request: Request
): Promise<NextResponse<ApiResponse<AuthUser>>> {
  try {
    // Check if any user already exists
    const userCount = await db.user.count();
    if (userCount > 0) {
      return NextResponse.json(
        { success: false, error: "System is already initialized" },
        { status: 400 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = setupSchema.safeParse(body);
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

    const { username, password, displayName } = parsed.data;

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await db.user.create({
      data: {
        username,
        passwordHash,
        displayName,
        role: "admin",
      },
    });

    // Sign JWT tokens
    const jwtPayload = {
      userId: user.id,
      username: user.username,
      role: user.role as "admin" | "user",
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
      role: user.role as "admin" | "user",
    };

    const response = NextResponse.json(
      { success: true, data: authUser },
      { status: 201 }
    );

    // Set auth cookies
    await setAuthCookies(response, accessToken, refreshToken);

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Setup failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
