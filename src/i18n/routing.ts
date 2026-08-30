import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";
import { locales, defaultLocale } from "@/env";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Always show the locale prefix so the chosen language is explicit in the URL
  // (login, public booking page, shared links).
  localePrefix: "always",
  localeCookie: {
    name: "BARBER_LOCALE",
    maxAge: 60 * 60 * 24 * 365,
  },
});

export type AppLocale = (typeof routing.locales)[number];

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
