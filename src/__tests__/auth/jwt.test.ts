import { describe, it, expect } from "vitest";
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from "@/lib/auth/jwt";

describe("JWT utils", () => {
  it("should sign and verify access token", async () => {
    const payload = { userId: "user-1", username: "admin", role: "admin" as const };
    const token = await signAccessToken(payload);
    const decoded = await verifyToken(token);
    expect(decoded.userId).toBe("user-1");
    expect(decoded.username).toBe("admin");
  });

  it("should sign and verify refresh token", async () => {
    const payload = { userId: "user-1", username: "admin", role: "admin" as const };
    const token = await signRefreshToken(payload);
    const decoded = await verifyToken(token);
    expect(decoded.userId).toBe("user-1");
  });

  it("should reject invalid token", async () => {
    await expect(verifyToken("invalid-token")).rejects.toThrow();
  });
});
