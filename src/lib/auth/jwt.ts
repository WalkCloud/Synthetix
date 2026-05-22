import { signToken, verifyToken as coreVerify, ACCESS_EXPIRES, REFRESH_EXPIRES } from "./token-core";
import type { JWTPayload } from "@/types/auth";

export { ACCESS_EXPIRES, REFRESH_EXPIRES } from "./token-core";

export async function signAccessToken(payload: JWTPayload): Promise<string> {
  return signToken(payload as Record<string, unknown>, ACCESS_EXPIRES);
}

export async function signRefreshToken(payload: JWTPayload): Promise<string> {
  return signToken(payload as Record<string, unknown>, REFRESH_EXPIRES);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const result = await coreVerify<JWTPayload>(token);
  if (!result) throw new Error("Invalid or expired token");
  return result;
}
