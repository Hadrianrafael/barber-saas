import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { APP_SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/server/auth/cookies";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Edge middleware. Cannot touch the DB, so it only does *coarse* gating on
 * cookie presence (defence in depth). Authoritative auth + RBAC checks run in
 * server components / actions via requireAppSession / requireTenantContext.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Super Admin realm: not localized, its own cookie -------------------
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const isAuthPage = pathname === "/admin/sign-in";
    const hasAdminCookie = req.cookies.has(ADMIN_SESSION_COOKIE);
    if (!isAuthPage && !hasAdminCookie) {
      return NextResponse.redirect(new URL("/admin/sign-in", req.url));
    }
    if (isAuthPage && hasAdminCookie) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    return NextResponse.next();
  }

  // --- Tenant app: run i18n, then gate protected sections ----------------
  const response = intlMiddleware(req);

  const segments = pathname.split("/").filter(Boolean);
  const maybeLocale = segments[0];
  const isLocale = (routing.locales as readonly string[]).includes(maybeLocale ?? "");
  const rest = isLocale ? segments.slice(1) : segments;
  const section = rest[0];
  const locale = isLocale ? maybeLocale! : routing.defaultLocale;

  const PROTECTED = new Set([
    "dashboard",
    "agenda",
    "clients",
    "team",
    "services",
    "finance",
    "campaigns",
    "conversations",
    "messages",
    "payments",
    "billing",
    "settings",
    "onboarding",
  ]);
  if (section && PROTECTED.has(section) && !req.cookies.has(APP_SESSION_COOKIE)) {
    return NextResponse.redirect(new URL(`/${locale}/sign-in`, req.url));
  }

  return response;
}

export const config = {
  // Skip Next internals, API routes and static assets.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
