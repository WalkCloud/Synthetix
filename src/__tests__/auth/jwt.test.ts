import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from "@/lib/auth/jwt";

describe("JWT utils", () => {
  const payload = { userId: "user-1", username: "admin", role: "admin" as const };

  it("signs access tokens with the access kind", async () => {
    const token = await signAccessToken(payload);
    const decoded = await verifyToken(token, "access");

    expect(decoded).toMatchObject({ ...payload, kind: "access" });
  });

  it("signs refresh tokens with the refresh kind", async () => {
    const token = await signRefreshToken(payload);
    const decoded = await verifyToken(token, "refresh");

    expect(decoded).toMatchObject({ ...payload, kind: "refresh" });
  });

  it("rejects a token when its kind does not match the expected location", async () => {
    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken(payload);

    await expect(verifyToken(accessToken, "refresh")).rejects.toThrow();
    await expect(verifyToken(refreshToken, "access")).rejects.toThrow();
  });

  it("rejects legacy tokens without a kind when a kind is expected", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const legacyToken = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("15m")
      .setIssuedAt()
      .sign(secret);

    await expect(verifyToken(legacyToken, "access")).rejects.toThrow();
  });

  it("rejects invalid tokens", async () => {
    await expect(verifyToken("invalid-token", "access")).rejects.toThrow();
  });
});
