import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque token helpers.
 *
 * We generate a high-entropy random token, hand the *raw* token to the user
 * (cookie / e-mail link) and persist only its SHA-256 hash. A stolen database
 * dump therefore cannot be used to resume sessions or reset passwords.
 */

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
