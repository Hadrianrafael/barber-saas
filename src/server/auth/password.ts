import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * bcrypt (cost 12) — pure-JS, zero native build, and still an OWASP-acceptable
 * password hash. Migration path to argon2id is documented in
 * docs/adr/0002-auth-approach.md; `needsRehash` lets us upgrade transparently
 * on next login.
 */
const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  const rounds = Number(hash.split("$")[2] ?? "0");
  return !Number.isNaN(rounds) && rounds < COST;
}

/** Password policy: >= 10 chars, at least one letter and one digit. */
export function isStrongPassword(pw: string): boolean {
  return pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}
