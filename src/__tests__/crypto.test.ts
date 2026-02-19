import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";
import { randomBytes } from "crypto";

// Set a test encryption key (32 bytes base64)
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("crypto", () => {
  it("encrypts and decrypts a string correctly", () => {
    const plaintext = "my-secret-password-123";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    const plaintext = "same-input";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it("decrypts both to the same value", () => {
    const plaintext = "consistent-decrypt";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it("handles empty string", () => {
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles unicode", () => {
    const plaintext = "p@ssw0rd!#$%^&*()_+=中文";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("throws on invalid encrypted format", () => {
    expect(() => decrypt("not-valid")).toThrow();
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    // Tamper with the ciphertext
    parts[2] = "AAAA" + parts[2].slice(4);
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});
