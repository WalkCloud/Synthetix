import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "@/types/auth";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "default-secret-change-me"
);
const accessExpires = process.env.JWT_ACCESS_EXPIRES || "15m";
const refreshExpires = process.env.JWT_REFRESH_EXPIRES || "7d";

export async function signAccessToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(accessExpires)
    .setIssuedAt()
    .sign(secret);
}

export async function signRefreshToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(refreshExpires)
    .setIssuedAt()
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JWTPayload;
}
