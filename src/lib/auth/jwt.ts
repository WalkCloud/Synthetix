import { signToken, verifyToken as coreVerify, ACCESS_EXPIRES, REFRESH_EXPIRES } from "./token-core";
import type { JWTPayload, TokenKind } from "@/types/auth";

export { ACCESS_EXPIRES, REFRESH_EXPIRES } from "./token-core";

type TokenPayloadInput = Omit<JWTPayload, "kind">;

export async function signAccessToken(payload: TokenPayloadInput): Promise<string> {
  return signToken(payload as unknown as Record<string, unknown>, ACCESS_EXPIRES, "access");
}

export async function signRefreshToken(payload: TokenPayloadInput): Promise<string> {
  return signToken(payload as unknown as Record<string, unknown>, REFRESH_EXPIRES, "refresh");
}

export async function verifyToken(
  token: string,
  expectedKind?: TokenKind,
): Promise<JWTPayload> {
  const result = await coreVerify<JWTPayload>(token, expectedKind);
  if (!result) throw new Error("Invalid or expired token");
  return result;
}
