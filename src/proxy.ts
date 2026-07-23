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

/**
 * Detect a Bearer token in the Authorization header (no DB lookup here, to
 * stay compatible with the edge runtime). The route handler's getAuthUser()
 * performs the actual API-key validation against the database; this only
 * decides whether to let `/api/` requests through to the handler instead of
 * short-circuiting to 401 at the edge.
 */
function hasBearerToken(request: NextRequest): boolean {
  const auth = request.headers.get("authorization");
  return !!auth && /^Bearer\s+.+$/i.test(auth.trim());
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

  // No valid cookie/JWT: let programmatic clients through if they carry a
  // Bearer token. The route handler's getAuthUser() validates the API key
  // against the database and returns 401 there if it is unknown or revoked.
  if (pathname.startsWith("/api/") && hasBearerToken(request)) {
    return NextResponse.next();
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
