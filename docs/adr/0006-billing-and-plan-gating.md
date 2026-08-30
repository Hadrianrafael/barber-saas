# ADR 0006 — SaaS billing & plan gating

**Status:** accepted · **Date:** 2026-09-02

## Context

Barbershops pay the platform a monthly (or yearly) subscription. We need real
Stripe billing (checkout, trial, upgrade/downgrade, cancel, dunning, invoices,
customer portal), plan limits enforced server-side, and everything working in
dev without Stripe keys — but never faking a payment.

## Decision

### Plans are data

`Plan` rows carry `priceCents` (+ optional `priceCentsYearly`),
`stripePriceId` / `stripePriceIdYearly`, `trialDays`, and a `limits` JSON
(`{ maxEmployees, maxServices, maxCustomers, maxMonthlyAppointments,
maxMonthlyMessages, maxCampaignsPerMonth, maxUnits, whatsapp, chatbot,
campaigns, loyalty }`). No price or limit is hard-coded in a component. Seed
sets three plans; Stripe price ids are filled in per environment.

### Webhooks are the source of truth

`POST /api/webhooks/stripe` verifies the signature, then inserts a
`WebhookEvent` row unique on `(provider, eventId)` **before** processing —
duplicate deliveries are a 200 no-op. Handler failure → 500 so Stripe retries.
`customer.subscription.*` drives `Subscription.status` / period / plan;
`invoice.*` drives the billing history, the `Payment` ledger row and the
`PAST_DUE` grace window (7 days). `Tenant.status` mirrors the subscription so
route guards don't need a join. `status = ACTIVE` is only ever set from a
webhook — checkout success redirects never mutate billing state.

### Plan gating

`src/features/billing/gate.ts`:

- `getEntitlements(tenantId)` → `{ planCode, status, limits, inGrace, blocked,
  blockReason, ... }`. A tenant with no subscription uses `TRIAL_LIMITS` (a
  conservative ceiling) and is `blocked` once `Tenant.trialEndsAt` passes.
- `assertWithinLimit(tenantId, resource)` / `assertFeature(tenantId, feature)`
  throw `PlanLimitError` (`LIMIT_EXCEEDED` | `FEATURE_UNAVAILABLE` |
  `BILLING_BLOCKED`).
- Wired into the create paths for employees, services and customers (and, later,
  campaigns/messages). The chatbot and public-booking flows call the same gate —
  the AI can never exceed a limit the owner couldn't.

### Config-gated, never simulated

`isConfigured.stripe` (secret key + webhook secret both present) toggles the
feature. When off: `/pricing` and `/billing` render; checkout/portal buttons
show a "configure Stripe" notice; the webhook endpoint ACKs 200 and records
nothing; onboarding's plan step records a **trial** `Subscription` (TRIALING,
not a payment) and continues to the dashboard. Setup steps: `docs/deployment/stripe.md`.

## Consequences

- Adding another provider (Mercado Pago, …) = implement `PaymentProvider` +
  a second webhook route mapping to the same handlers. `Subscription` /
  `Invoice` / `Payment` are provider-neutral.
- The 7-day grace is a constant in `webhooks.ts` / `gate.ts`; promote to a
  platform setting if needed.
- `Plan.interval` was dropped — the billing period lives on `Subscription`
  (chosen at checkout), so one Plan serves both monthly and yearly.
