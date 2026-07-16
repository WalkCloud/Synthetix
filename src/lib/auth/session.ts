import { cookies } from "next/headers";
import { verifyToken, signAccessToken, signRefreshToken } from "./jwt";
import { ACCESS_MAX_AGE, REFRESH_MAX_AGE } from "./token-core";
import type { AuthUser, JWTPayload } from "@/types/auth";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

const isProduction = process.env.NODE_ENV === "production";
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

async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_KEY)?.value ?? null;
}

async function getRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_KEY)?.value ?? null;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const accessToken = await getAccessToken();
  if (accessToken) {
    try {
      const payload = await verifyToken(accessToken, "access");
      return payloadToAuthUser(payload);
    } catch {
      // access token expired, try refresh below
    }
  }

  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    const payload = await verifyToken(refreshToken, "refresh");
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
    const payload = await verifyToken(refreshToken, "refresh");
    const user = payloadToAuthUser(payload);
    const jwtPayload: Omit<JWTPayload, "kind"> = {
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

function payloadToAuthUser(payload: JWTPayload): AuthUser {
  return {
    id: payload.userId,
    username: payload.username,
    email: null,
    displayName: "",
    role: payload.role,
  };
}
