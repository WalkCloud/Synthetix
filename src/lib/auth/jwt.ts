import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "@/types/auth";

if (!process.env.JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is required. " +
    "Set it before starting the server."
  );
}

const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const accessExpires = process.env.JWT_ACCESS_EXPIRES || "15m";
const refreshExpires = process.env.JWT_REFRESH_EXPIRES || "7d";

export async function signToken(
  payload: JWTPayload,
  expiresIn: string
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(secret);
}

export async function signAccessToken(payload: JWTPayload): Promise<string> {
  return signToken(payload, accessExpires);
}

export async function signRefreshToken(payload: JWTPayload): Promise<string> {
  return signToken(payload, refreshExpires);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JWTPayload;
}
