import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { APP_SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/server/auth/cookies";

const intlMiddleware = createIntlMiddleware(routing);

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Edge middleware. Cannot touch the DB, so it only does *coarse* gating on
 * cookie presence (defence in depth). Authoritative auth + RBAC checks run in
 * server components / actions via requireAppSession / requireTenantContext.
 *
 * Also stamps a correlation id (`x-request-id`) on every request + response so
 * structured logs can be tied together (see src/lib/request-context.ts).
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();

  const withId = (res: NextResponse) => {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };
  const forwardHeaders = new Headers(req.headers);
  forwardHeaders.set(REQUEST_ID_HEADER, requestId);
  const passThrough = () => withId(NextResponse.next({ request: { headers: forwardHeaders } }));

  // --- Super Admin realm: not localized, its own cookie -------------------
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const isAuthPage = pathname === "/admin/sign-in";
    const hasAdminCookie = req.cookies.has(ADMIN_SESSION_COOKIE);
    if (!isAuthPage && !hasAdminCookie) {
      return withId(NextResponse.redirect(new URL("/admin/sign-in", req.url)));
    }
    if (isAuthPage && hasAdminCookie) {
      return withId(NextResponse.redirect(new URL("/admin", req.url)));
    }
    return passThrough();
  }

  // --- Tenant app: run i18n, then gate protected sections ----------------
  const response = withId(intlMiddleware(req));
  response.headers.set(REQUEST_ID_HEADER, requestId);

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
    "import",
    "team",
    "services",
    "finance",
    "campaigns",
    "loyalty",
    "reviews",
    "conversations",
    "messages",
    "payments",
    "billing",
    "settings",
    "onboarding",
  ]);
  if (section && PROTECTED.has(section) && !req.cookies.has(APP_SESSION_COOKIE)) {
    return withId(NextResponse.redirect(new URL(`/${locale}/sign-in`, req.url)));
  }

  return response;
}

export const config = {
  // Skip Next internals, API routes and static assets.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
