import "server-only";
import { cookies } from "next/headers";
import { env } from "@/env";

/**
 * Two separate cookie namespaces so the Super Admin realm and the tenant app
 * never share a session:
 *   - APP_SESSION   → tenant users (owners, managers, barbers)
 *   - ADMIN_SESSION → platform administrators only
 */
export const APP_SESSION_COOKIE = "barber_session";
export const ADMIN_SESSION_COOKIE = "barber_admin_session";

const baseCookie = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function setSessionCookie(
  name: typeof APP_SESSION_COOKIE | typeof ADMIN_SESSION_COOKIE,
  token: string,
  expiresAt: Date,
) {
  const store = await cookies();
  store.set(name, token, { ...baseCookie, expires: expiresAt });
}

export async function clearSessionCookie(
  name: typeof APP_SESSION_COOKIE | typeof ADMIN_SESSION_COOKIE,
) {
  const store = await cookies();
  store.set(name, "", { ...baseCookie, maxAge: 0 });
}

export async function readSessionCookie(
  name: typeof APP_SESSION_COOKIE | typeof ADMIN_SESSION_COOKIE,
): Promise<string | null> {
  const store = await cookies();
  return store.get(name)?.value ?? null;
}
