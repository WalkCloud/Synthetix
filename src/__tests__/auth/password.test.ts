import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password utils", () => {
  it("should hash a password", async () => {
    const hash = await hashPassword("test123");
    expect(hash).not.toBe("test123");
    expect(hash.startsWith("$2b$")).toBe(true);
  });

  it("should verify correct password", async () => {
    const hash = await hashPassword("test123");
    const result = await verifyPassword("test123", hash);
    expect(result).toBe(true);
  });

  it("should reject wrong password", async () => {
    const hash = await hashPassword("test123");
    const result = await verifyPassword("wrong", hash);
    expect(result).toBe(false);
  });
});
