import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { APP_SESSION_COOKIE, ADMIN_SESSION_COOKIE, readSessionCookie } from "./cookies";
import { resolveSession, type SessionContext } from "./session";
import { resolveActiveTenant } from "./active-tenant";

export { resolveActiveTenant };

/**
 * Request-scoped current-user accessors. `cache()` dedupes the lookup across a
 * single render pass so layouts + pages don't each hit the session store.
 */

export const getAppSession = cache(async (): Promise<SessionContext | null> => {
  const token = await readSessionCookie(APP_SESSION_COOKIE);
  if (!token) return null;
  const ctx = await resolveSession(token);
  if (!ctx || ctx.isAdminSession) return null;
  return ctx;
});

export const getAdminSession = cache(async (): Promise<SessionContext | null> => {
  const token = await readSessionCookie(ADMIN_SESSION_COOKIE);
  if (!token) return null;
  const ctx = await resolveSession(token);
  if (!ctx || !ctx.isAdminSession || !ctx.isPlatformAdmin) return null;
  return ctx;
});

export async function requireAppSession(locale: string): Promise<SessionContext> {
  const ctx = await getAppSession();
  if (!ctx) redirect(`/${locale}/sign-in`);
  return ctx;
}

export async function requireAdminSession(): Promise<SessionContext> {
  const ctx = await getAdminSession();
  if (!ctx) redirect(`/admin/sign-in`);
  return ctx;
}
