# Architecture

## Overview

A single Next.js 15 application serves three surfaces:

1. **Tenant app** — `src/app/(site)/[locale]/(app)/…` — dashboard for owners /
   managers / barbers. Locale-prefixed URLs.
2. **Public pages** — `src/app/(site)/[locale]/…` — marketing, pricing, and the
   per-barbershop booking page (`/barber/{slug}`), all in pt-BR / en / es.
3. **Super Admin realm** — `src/app/(admin)/admin/…` — platform operations. Its
   own root layout, its own session cookie, its own sign-in. Never shares a
   session with the tenant app.

Business logic lives in `src/server/**` and `src/features/**` and does **not**
import Next primitives beyond `headers()` / `cookies()` / `redirect()`. This
keeps the door open to extract a standalone API later without rewriting domain
code.

## Multi-tenancy

Shared schema, `tenantId` column on every tenant-owned table (ADR 0001). All
application access goes through `forTenant(tenantId)` (`src/server/db/tenant.ts`),
a Prisma client extension that:

- merges `where.tenantId` into every read and `where`-bearing write
- injects `data.tenantId` into every create

The bare `prisma` client is reserved for identity/platform tables (`User`,
`Plan`, `Session`, `WebhookEvent`) and the Super Admin realm. A cross-tenant
leak is the most expensive bug this product can ship; the isolation test suite
(Slice 12) asserts it can't happen.

## AuthN / AuthZ

- **Sessions:** opaque random token in an httpOnly cookie; only its SHA-256 hash
  is stored (`Session` table), Redis-cached ~10 s for latency, instantly
  revocable. Two cookie namespaces: `barber_session` (tenant) and
  `barber_admin_session` (platform admin). ADR 0002.
- **Passwords:** bcrypt cost 12 (`needsRehash` enables a transparent upgrade
  path). ADR 0002.
- **RBAC:** fixed roles `OWNER > MANAGER > BARBER` + out-of-band `PLATFORM_ADMIN`.
  Permission matrix is declared as data in `src/server/rbac/permissions.ts`.
  Every server action / route handler enters through `requireTenantContext()`,
  which returns `{ tenantId, role, db: forTenant(...), can, assert }`.
  Authorization is always decided server-side.
- **Support impersonation:** a time-boxed `ImpersonationGrant` row mints a scoped
  session; every action is stamped into `AuditLog` with
  `actorType = PLATFORM_ADMIN`. No password sharing. (Wired in Slice 2+.)

## i18n

`next-intl` with `localePrefix: "always"`. Message catalogues in `/messages/*.json`
split by namespace. Components never hard-code copy. Locale is selectable on the
login screen and in settings, persisted in the `BARBER_LOCALE` cookie and on the
`User` / `Customer` records.

## Integrations (all env-gated, degrade cleanly, never simulated)

| Concern | Interface | Active driver | Fallback when unconfigured |
|---|---|---|---|
| Payments | `PaymentProvider` (`src/server/payments`) | Stripe | throws `PaymentProviderNotConfiguredError` |
| E-mail | `sendEmail` (`src/server/mail`) | Resend | console transport (logs, no delivery) |
| Object storage | `StorageDriver` (`src/server/storage`) | Azure Blob | local disk under `.storage`, served by `/api/storage` |
| Queue | BullMQ (`src/worker`) | Redis | — (Redis required) |
| WhatsApp | Slice 8 | Meta Cloud API (official) | endpoints return 503 |
| Chatbot | Slice 10 | Anthropic | endpoints return 503 |

`isConfigured.*` in `src/env.ts` is the single source of truth for feature
availability.

## Background work

`src/worker/` is a separate process (own Azure Container App). Queues: `email`,
`whatsapp`, `campaign`, `reminders`, `webhooks`. Scheduled dispatch (reminders,
campaigns) via an Azure Container Apps cron job + BullMQ repeatable jobs.

## Money

Always integer minor units (`amountCents: Int`) + ISO-4217 `currency`. Never
floats. Two never-mixed flows: SaaS subscription (platform Stripe account) and
client→barbershop payment (Stripe Connect, connected account, optional
application fee).

## Request path (tenant action)

```
Client form ──POST──▶ Server Action ("use server")
                         │ zod validate
                         │ requireTenantContext({ permission })
                         │   ├─ getAppSession()  → resolve opaque session
                         │   ├─ resolveActiveTenant() → tenantId + role
                         │   └─ assert(permission)   → RBAC
                         │ ctx.db (forTenant) … writes scoped to tenantId
                         │ AuditLog for sensitive actions
                         ▼
                     revalidate / redirect
```
