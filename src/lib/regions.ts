/**
 * Regional configuration for international onboarding.
 *
 * Each supported country carries its default currency and IANA timezone(s), a
 * dial code for international phone input, and the locales that make sense as a
 * default there. The barbershop can override currency / timezone during
 * onboarding — these are only smart defaults.
 *
 * Date/time and number formatting is done at render time with `Intl.*` using the
 * active UI locale + the tenant's timezone/currency; nothing is hard-coded.
 */

export const SUPPORTED_LOCALES = ["pt-BR", "en", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export interface CountryConfig {
  code: string; // ISO 3166-1 alpha-2
  nameKey: string; // i18n key under `countries`
  dialCode: string; // E.164 country calling code, with '+'
  currency: string; // ISO 4217
  timezones: string[]; // IANA; first is the default
  defaultLocale: SupportedLocale;
}

export const COUNTRIES: CountryConfig[] = [
  {
    code: "BR",
    nameKey: "BR",
    dialCode: "+55",
    currency: "BRL",
    timezones: [
      "America/Sao_Paulo",
      "America/Bahia",
      "America/Fortaleza",
      "America/Manaus",
      "America/Cuiaba",
      "America/Belem",
      "America/Recife",
      "America/Rio_Branco",
    ],
    defaultLocale: "pt-BR",
  },
  {
    code: "US",
    nameKey: "US",
    dialCode: "+1",
    currency: "USD",
    timezones: [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
    ],
    defaultLocale: "en",
  },
  {
    code: "MX",
    nameKey: "MX",
    dialCode: "+52",
    currency: "MXN",
    timezones: ["America/Mexico_City", "America/Cancun", "America/Tijuana", "America/Monterrey"],
    defaultLocale: "es",
  },
  {
    code: "ES",
    nameKey: "ES",
    dialCode: "+34",
    currency: "EUR",
    timezones: ["Europe/Madrid", "Atlantic/Canary"],
    defaultLocale: "es",
  },
  {
    code: "PT",
    nameKey: "PT",
    dialCode: "+351",
    currency: "EUR",
    timezones: ["Europe/Lisbon", "Atlantic/Madeira", "Atlantic/Azores"],
    defaultLocale: "pt-BR",
  },
  {
    code: "AR",
    nameKey: "AR",
    dialCode: "+54",
    currency: "ARS",
    timezones: [
      "America/Argentina/Buenos_Aires",
      "America/Argentina/Cordoba",
      "America/Argentina/Mendoza",
    ],
    defaultLocale: "es",
  },
  {
    code: "CO",
    nameKey: "CO",
    dialCode: "+57",
    currency: "COP",
    timezones: ["America/Bogota"],
    defaultLocale: "es",
  },
  {
    code: "CL",
    nameKey: "CL",
    dialCode: "+56",
    currency: "CLP",
    timezones: ["America/Santiago", "Pacific/Easter", "America/Punta_Arenas"],
    defaultLocale: "es",
  },
  {
    code: "PE",
    nameKey: "PE",
    dialCode: "+51",
    currency: "PEN",
    timezones: ["America/Lima"],
    defaultLocale: "es",
  },
  {
    code: "UY",
    nameKey: "UY",
    dialCode: "+598",
    currency: "UYU",
    timezones: ["America/Montevideo"],
    defaultLocale: "es",
  },
  {
    code: "PY",
    nameKey: "PY",
    dialCode: "+595",
    currency: "PYG",
    timezones: ["America/Asuncion"],
    defaultLocale: "es",
  },
  {
    code: "GB",
    nameKey: "GB",
    dialCode: "+44",
    currency: "GBP",
    timezones: ["Europe/London"],
    defaultLocale: "en",
  },
  {
    code: "CA",
    nameKey: "CA",
    dialCode: "+1",
    currency: "CAD",
    timezones: [
      "America/Toronto",
      "America/Winnipeg",
      "America/Edmonton",
      "America/Vancouver",
      "America/Halifax",
    ],
    defaultLocale: "en",
  },
];

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));

export function getCountry(code: string): CountryConfig | undefined {
  return byCode.get(code.toUpperCase());
}

/** All IANA timezones we offer (union across countries), de-duplicated + sorted. */
export const ALL_TIMEZONES = Array.from(new Set(COUNTRIES.flatMap((c) => c.timezones))).sort();

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Common ISO-4217 currencies we accept (superset of country defaults). */
export const SUPPORTED_CURRENCIES = Array.from(
  new Set([...COUNTRIES.map((c) => c.currency), "EUR", "USD"]),
).sort();
