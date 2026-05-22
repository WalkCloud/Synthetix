import { NextRequest, NextResponse } from "next/server";
import { signToken, verifyToken, ACCESS_EXPIRES, REFRESH_EXPIRES, ACCESS_MAX_AGE, REFRESH_MAX_AGE } from "@/lib/auth/token-core";

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

interface TokenPayload {
  userId: string;
  username: string;
  role: string;
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
    const payload = await verifyToken<TokenPayload>(accessToken);
    if (payload) {
      return NextResponse.next();
    }
  }

  if (refreshToken) {
    const payload = await verifyToken<TokenPayload>(refreshToken);
    if (payload) {
      const [newAccessToken, newRefreshToken] = await Promise.all([
        signToken(payload as unknown as Record<string, unknown>, ACCESS_EXPIRES),
        signToken(payload as unknown as Record<string, unknown>, REFRESH_EXPIRES),
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
