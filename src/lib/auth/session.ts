import { cookies } from "next/headers";
import { verifyToken, signAccessToken, signRefreshToken } from "./jwt";
import type { AuthUser, JWTPayload } from "@/types/auth";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

const ACCESS_MAX_AGE = 60 * 15; // 15 minutes
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const isProduction = process.env.NODE_ENV === "production";

const baseCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict" as const,
  path: "/",
};

export async function setAuthCookies(
  response: Response,
  accessToken: string,
  refreshToken: string
): Promise<void> {
  response.headers.append(
    "Set-Cookie",
    `${ACCESS_TOKEN_KEY}=${accessToken}; Max-Age=${ACCESS_MAX_AGE}; Path=/; HttpOnly; SameSite=Strict${isProduction ? "; Secure" : ""}`
  );
  response.headers.append(
    "Set-Cookie",
    `${REFRESH_TOKEN_KEY}=${refreshToken}; Max-Age=${REFRESH_MAX_AGE}; Path=/; HttpOnly; SameSite=Strict${isProduction ? "; Secure" : ""}`
  );
}

export function clearAuthCookies(response: Response): void {
  response.headers.append(
    "Set-Cookie",
    `${ACCESS_TOKEN_KEY}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${isProduction ? "; Secure" : ""}`
  );
  response.headers.append(
    "Set-Cookie",
    `${REFRESH_TOKEN_KEY}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${isProduction ? "; Secure" : ""}`
  );
}

export async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_KEY)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_KEY)?.value ?? null;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  try {
    const payload = await verifyToken(accessToken);
    return payloadToAuthUser(payload);
  } catch {
    return null;
  }
}

export async function refreshSession(): Promise<{
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
} | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    const payload = await verifyToken(refreshToken);
    const user = payloadToAuthUser(payload);
    const jwtPayload: JWTPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
    };
    const [newAccessToken, newRefreshToken] = await Promise.all([
      signAccessToken(jwtPayload),
      signRefreshToken(jwtPayload),
    ]);
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user,
    };
  } catch {
    return null;
  }
}

export function payloadToAuthUser(payload: JWTPayload): AuthUser {
  return {
    id: payload.userId,
    username: payload.username,
    email: null,
    displayName: "",
    role: payload.role,
  };
}
