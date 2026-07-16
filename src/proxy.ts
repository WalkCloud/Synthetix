import { NextRequest, NextResponse } from "next/server";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";
import { verifyToken, ACCESS_MAX_AGE, REFRESH_MAX_AGE } from "@/lib/auth/token-core";
import type { JWTPayload } from "@/types/auth";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";
const isProduction = process.env.NODE_ENV === "production";

const PUBLIC_PATHS = [
  "/login",
  "/api/v1/auth",
  "/api/v1/system",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (publicPath) =>
      pathname === publicPath || pathname.startsWith(publicPath + "/")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_KEY)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_KEY)?.value;

  if (accessToken) {
    const payload = await verifyToken<JWTPayload>(accessToken, "access");
    if (payload) {
      return NextResponse.next();
    }
  }

  if (refreshToken) {
    const payload = await verifyToken<JWTPayload>(refreshToken, "refresh");
    if (payload) {
      const tokenPayload: Omit<JWTPayload, "kind"> = {
        userId: payload.userId,
        username: payload.username,
        role: payload.role,
      };
      const [newAccessToken, newRefreshToken] = await Promise.all([
        signAccessToken(tokenPayload),
        signRefreshToken(tokenPayload),
      ]);

      const response = NextResponse.next();
      response.cookies.set(ACCESS_TOKEN_KEY, newAccessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict",
        path: "/",
        maxAge: ACCESS_MAX_AGE,
      });
      response.cookies.set(REFRESH_TOKEN_KEY, newRefreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict",
        path: "/",
        maxAge: REFRESH_MAX_AGE,
      });
      return response;
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
