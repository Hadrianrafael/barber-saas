# Roadmap — V1 comercial

Vertical slices. Each slice ships a flow that works end to end (UI → server →
DB → side effects) and is tested before the next begins. Order follows the
priority list in the project brief: get sellable flows in first.

| # | Slice | Scope | State |
|---|---|---|---|
| 0 | **Foundation** | Repo, tooling, CI, Docker, Next app skeleton, full Prisma multi-tenant schema, env validation, i18n (pt-BR/en/es), Azure IaC, docs/ADRs | ✅ done |
| 1 | **Auth · Multi-tenancy · RBAC** | Sign up, sign in/out, e-mail verification, password reset/change, opaque sessions, tenant isolation layer (`forTenant`), role guards (`requireTenantContext`), separate Super Admin realm + console shell | ✅ core done |
| 2 | **Tenant onboarding + settings** | Create barbershop (name → slug → plan choice), business hours, holidays, profile, public slug, booking config | ⬜ |
| 3 | **Team · Services · Schedule** | Barbers (work hours, time off, vacation, commission), services CRUD, agenda day/week/month, **server-side conflict prevention** (serializable tx + Postgres GiST exclusion) | ⬜ |
| 4 | **Clients CRM** | Client CRUD, appointment history, preferred barber, spend, segments, communication consent / opt-in | ⬜ |
| 5 | **Stripe subscription (SaaS billing)** | `/pricing`, checkout, plans as data + limits enforced server-side, idempotent webhooks, plan gating, grace period, billing portal | ⬜ |
| 6 | **Stripe Connect + payments** | Connected account onboarding + status, one-off / subscription / pay-at-booking client payments, platform fee, refunds | ⬜ |
| 7 | **Financeiro** | Tenant financial dashboard, date filters, commissions, reconciliation driven by webhooks | ⬜ |
| 8 | **Notifications — e-mail + WhatsApp** | Multilingual templates, send log + status, WhatsApp Business Platform (official Cloud API) integration, reminder cron | ⬜ |
| 9 | **Public booking page** | `/barber/{slug}` in 3 languages: service → barber → slot → payment → confirmation | ⬜ |
| 10 | **Chatbot IA** | Per-tenant, tool/function-calling grounded in backend data (never invents price/availability), language-aware, human handoff, Conversations panel | ⬜ |
| 11 | **Import · Campaigns · Loyalty/Reviews** | CSV/XLSX import (preview → dedupe → confirm), WhatsApp/e-mail campaigns with variables, feature-flagged loyalty & reviews | ⬜ |
| 12 | **Hardening** | Rate-limit coverage, audit-log coverage, cross-tenant isolation test suite, E2E on critical flows, empty/error states pass | ⬜ |

## Definition of done per slice

- Happy path + error/empty states implemented (no dead buttons)
- Input validated with zod; authorization checked on the server via `requireTenantContext`
- Every tenant-scoped query goes through `forTenant()`
- Automated test for the critical path (unit and/or E2E)
- No secret in client code; external integrations env-gated, never simulated
- `npm run typecheck && npm run lint && npm test` green
