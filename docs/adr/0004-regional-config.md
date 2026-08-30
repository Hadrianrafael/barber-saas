# ADR 0004 — Per-barbershop regional configuration

**Status:** accepted · **Date:** 2026-08-30

## Context

The product launches in Brazil, the US and Spanish-speaking markets and must
expand without a rebuild. Each barbershop can be in a different country, run on a
different timezone, price in a different currency, and serve clients in a
different language.

## Decision

Regional settings live **on the `Tenant` row**, not globally:

| Field | Purpose |
|---|---|
| `country` | ISO 3166-1 alpha-2; drives smart defaults |
| `currency` | ISO 4217; every money field also stores its own `currency` code |
| `timezone` | IANA; appointment instants are stored `timestamptz`, rendered per tenant |
| `locale` | default UI + notification language (`pt-BR` \| `en` \| `es`) |

- `src/lib/regions.ts` is the single catalogue: supported countries with default
  currency / timezone(s) / dial code / default locale, plus validators. The
  onboarding wizard pre-fills currency + timezone from the chosen country; the
  owner can override.
- **Formatting is never hard-coded.** Dates, times and money are formatted at
  render time with `Intl.DateTimeFormat` / `Intl.NumberFormat` using the active
  UI locale and the tenant's timezone/currency.
- **Phone numbers** are stored loosely normalised (`+` and digits). Strict E.164
  validation per country is deferred to the notification slice (WhatsApp/SMS
  need it); the dial code hint comes from `regions.ts`.
- Adding a country = one entry in `COUNTRIES` + its `countries.<CODE>` i18n key
  in the three catalogues. Adding a language = a new `messages/<locale>.json` +
  `APP_LOCALES`. No schema change.
- Changing a tenant's currency does **not** retro-convert stored amounts (each
  amount carries its own currency); this is stated in the settings UI.

## Consequences

- New markets are config, not code.
- `timestamptz` on `Appointment` / `BlockedTime` means slot math is timezone-safe
  from day one (Slice 3 relies on this + the GiST exclusion constraint).
- The public page and all tenant-facing surfaces read `tenant.locale` /
  `tenant.timezone` / `tenant.currency` — never a global constant.
