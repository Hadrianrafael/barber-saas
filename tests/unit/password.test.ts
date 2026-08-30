import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  isStrongPassword,
  needsRehash,
} from "@/server/auth/password";

describe("password", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("correct horse 4 battery");
    expect(hash).not.toContain("correct");
    expect(await verifyPassword("correct horse 4 battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(isStrongPassword("short1")).toBe(false);
    expect(isStrongPassword("allletters")).toBe(false);
    expect(isStrongPassword("1234567890")).toBe(false);
    expect(isStrongPassword("longenough1")).toBe(true);
  });

  it("flags weak-cost hashes for rehash", async () => {
    const weak = "$2a$08$abcdefghijklmnopqrstuv";
    expect(needsRehash(weak)).toBe(true);
    const strong = await hashPassword("longenough1");
    expect(needsRehash(strong)).toBe(false);
  });
});
