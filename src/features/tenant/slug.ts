import { slugify } from "@/lib/utils";

/**
 * Public slug rules for `/barber/{slug}`.
 *
 * - lowercase, ascii, `a-z0-9-`, 3–40 chars, no leading/trailing/double dash
 * - not in the reserved list (route names, brand words, abuse-prone terms)
 * - unique across tenants (checked in the DB via an injected `exists` fn so this
 *   module stays pure and unit-testable)
 */

export const RESERVED_SLUGS = new Set<string>([
  "admin",
  "api",
  "app",
  "auth",
  "barber",
  "billing",
  "book",
  "booking",
  "checkout",
  "dashboard",
  "settings",
  "onboarding",
  "sign-in",
  "sign-up",
  "signin",
  "signup",
  "login",
  "logout",
  "pricing",
  "support",
  "help",
  "about",
  "contact",
  "terms",
  "privacy",
  "status",
  "health",
  "static",
  "public",
  "assets",
  "images",
  "img",
  "css",
  "js",
  "favicon",
  "robots",
  "sitemap",
  "well-known",
  "pt-br",
  "en",
  "es",
  "www",
  "mail",
  "ftp",
  "root",
  "null",
  "undefined",
  "test",
]);

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSlug(input: string): string {
  return slugify(input).slice(0, SLUG_MAX).replace(/-+$/g, "");
}

export type SlugProblem = "too_short" | "too_long" | "invalid_chars" | "reserved";

export function validateSlugFormat(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN) return "too_short";
  if (slug.length > SLUG_MAX) return "too_long";
  if (!SLUG_RE.test(slug)) return "invalid_chars";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

type ExistsFn = (slug: string) => Promise<boolean>;

export interface SlugCheckResult {
  slug: string;
  available: boolean;
  problem: SlugProblem | "taken" | null;
}

export async function checkSlug(raw: string, exists: ExistsFn): Promise<SlugCheckResult> {
  const slug = normalizeSlug(raw);
  const problem = validateSlugFormat(slug);
  if (problem) return { slug, available: false, problem };
  if (await exists(slug)) return { slug, available: false, problem: "taken" };
  return { slug, available: true, problem: null };
}

/** Derive a unique slug from a display name, appending -2, -3, … on collision. */
export async function generateUniqueSlug(
  name: string,
  exists: ExistsFn,
  maxAttempts = 50,
): Promise<string> {
  let base = normalizeSlug(name);
  if (validateSlugFormat(base)) base = `barbearia-${base}`.slice(0, SLUG_MAX).replace(/-+$/g, "");
  if (validateSlugFormat(base)) base = "barbearia";

  if (!isReservedSlug(base) && !(await exists(base))) return base;

  for (let i = 2; i < maxAttempts + 2; i++) {
    const candidate = `${base}-${i}`.slice(0, SLUG_MAX).replace(/-+$/g, "");
    if (!isReservedSlug(candidate) && !(await exists(candidate))) return candidate;
  }
  // Extremely unlikely; fall back to a random suffix.
  return `${base}-${Math.abs(hashString(name + Date.now()))
    .toString(36)
    .slice(0, 6)}`.slice(0, SLUG_MAX);
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
