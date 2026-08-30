# ADR 0003 — Payment provider abstraction

**Status:** accepted · **Date:** 2026-08-29

## Context

Two distinct money flows:

1. **SaaS subscription** — a barbershop pays the platform (platform Stripe
   account).
2. **Client payment** — a client pays a barbershop (Stripe Connect connected
   account, optional platform application fee).

The brief requires (a) never mixing these flows, (b) an abstraction so other
providers (e.g. Mercado Pago for LATAM) can be added without rewriting the
financial domain, and (c) **no simulated payments** — if keys are missing, the
feature is clearly unavailable, not faked.

## Decision

- A `PaymentProvider` interface (`src/server/payments/provider.ts`) is the only
  thing the financial domain depends on. Methods are grouped by flow:
  subscription checkout + billing portal (flow 1); Connect onboarding + account
  status + one-off / subscription client checkout + refund (flow 2); plus
  signature-verified `verifyWebhook(payload, sig, kind)`.
- `StripeProvider` implements it. Every method guards on configuration and throws
  `PaymentProviderNotConfiguredError` when keys are absent.
- `paymentProvider` (`src/server/payments/index.ts`) is the single injection
  point. No other module imports a concrete provider.
- The two flows are also separated in data: `PaymentPurpose`
  (`SAAS_SUBSCRIPTION` | `CLIENT_PAYMENT`), separate webhook secrets
  (`STRIPE_WEBHOOK_SECRET` vs `STRIPE_CONNECT_WEBHOOK_SECRET`), and
  `WebhookEvent.provider` distinguishes `stripe` vs `stripe_connect`.
- Financial truth comes from webhooks (idempotent via `WebhookEvent` unique
  `(provider, eventId)`), never from client success redirects.

## Consequences

- Adding a provider = implement `PaymentProvider` + map its webhooks to the same
  domain events. Zero changes to `Payment` / `Subscription` / `Invoice` logic.
- Until Stripe keys are set, checkout / payout / webhook endpoints return a clear
  "not configured" error. The flows are complete and become live on key entry.
- `apiVersion` is pinned in `StripeProvider`; upgrades are a deliberate change.
