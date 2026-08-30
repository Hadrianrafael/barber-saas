# Barber SaaS

Multi-tenant SaaS platform for barbershops — scheduling, CRM, payments (Stripe +
Stripe Connect), subscriptions, multilingual messaging (e-mail / WhatsApp), a
per-tenant AI chatbot and a public booking page. Built to be sold, not demoed.

- **Stack:** Next.js 15 (App Router) · TypeScript · PostgreSQL + Prisma · Redis ·
  Tailwind + shadcn/ui · next-intl (pt-BR / en / es) · Stripe · Resend ·
  Anthropic (chatbot) · BullMQ
- **Target infra:** Microsoft Azure — Container Apps (web + worker + cron jobs),
  Azure Database for PostgreSQL Flexible Server, Azure Cache for Redis, Azure
  Blob Storage, Key Vault, Container Registry. Code is platform-agnostic
  (env-driven; storage / queue / mail / payments behind interfaces).

## Quick start (local)

```bash
cp .env.example .env          # then edit AUTH_SECRET at minimum
docker compose up -d          # postgres + redis
npm install
npm run db:migrate            # create schema
npm run db:seed               # 3 plans + a platform super admin
npm run dev                   # http://localhost:3000
npm run worker                # background jobs (separate terminal)
```

Super admin console: <http://localhost:3000/admin> (credentials from
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run worker` / `worker:start` | BullMQ background worker |
| `npm run cron:reminders` / `cron:retry-messages` | scheduled jobs |
| `npm run db:migrate` / `db:deploy` / `db:studio` / `db:seed` | Prisma |
| `npm run typecheck` / `lint` / `format` | Static checks |
| `npm test` / `test:e2e` | Vitest / Playwright |

## Docs

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | system design |
| [docs/ROADMAP.md](docs/ROADMAP.md) | vertical slices, all ✅ for V1 |
| [docs/SECURITY.md](docs/SECURITY.md) | always-on controls |
| [docs/adr/](docs/adr/) | 0001–0012 decision records |
| [docs/deployment/](docs/deployment/) | Azure, env vars, DB, local dev, Stripe/Connect, Resend, WhatsApp, chatbot |

## Layout

```
src/
  app/(site)/[locale]/…   localized tenant app + public pages
  app/(admin)/admin/…     Super Admin realm (separate session + root layout)
  app/api/…               health, webhooks, storage
  features/<domain>/…     feature-scoped UI + server actions + schema
  server/                 db, auth, rbac, mail, storage, payments (framework-agnostic)
  i18n/                   next-intl config
  worker/                 background job queues + processors
prisma/schema.prisma      multi-tenant data model
infra/                    Azure Bicep
docs/                     architecture, roadmap, ADRs
```

## Status

**V1 feature-complete** — all roadmap slices (0–11) implemented + production
hardening. See [docs/ROADMAP.md](docs/ROADMAP.md). Integrations (Stripe, Stripe
Connect, WhatsApp, Anthropic, Resend, Azure Blob) are fully wired but inactive
until their keys are set — the app never fakes a successful payment, message or
AI reply. State: **READY FOR CONFIGURATION** — provide the credentials in
[docs/deployment/environment-variables.md](docs/deployment/environment-variables.md)
and follow [docs/deployment/azure.md](docs/deployment/azure.md).
