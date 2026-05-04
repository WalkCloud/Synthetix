import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

describe("crypto utils", () => {
  it("should encrypt and decrypt a value", () => {
    const original = "sk-test-api-key-12345";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("should produce different ciphertext each time", () => {
    const encrypted1 = encrypt("same-value");
    const encrypted2 = encrypt("same-value");
    expect(encrypted1).not.toBe(encrypted2);
  });
});
