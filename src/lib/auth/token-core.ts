import { SignJWT, jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is required. " +
    "Set it before starting the server."
  );
}

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || "15m";
export const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || "7d";
export const ACCESS_MAX_AGE = 60 * 15;
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

export async function signToken(
  payload: Record<string, unknown>,
  expiresIn: string,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(secret);
}

export async function verifyToken<T = Record<string, unknown>>(
  token: string,
): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as T;
  } catch {
    return null;
  }
}
