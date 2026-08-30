# ADR 0007 — Stripe Connect & the two money flows

**Status:** accepted · **Date:** 2026-09-02

## Context

Barbershops must be able to charge their own clients (one-off, at booking, or
recurring) and receive payouts, with the platform taking an optional fee. This
must never be entangled with the SaaS subscription the barbershop pays *us*
(ADR 0006).

## Decision

### Two flows, isolated everywhere

| | SaaS subscription (ADR 0006) | Client → barbershop (this ADR) |
|---|---|---|
| Stripe account | platform | connected (Express) account |
| Webhook route | `/api/webhooks/stripe` | `/api/webhooks/stripe/connect` |
| Signing secret | `STRIPE_WEBHOOK_SECRET` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| `WebhookEvent.provider` | `stripe` | `stripe_connect` |
| `Payment.purpose` | `SAAS_SUBSCRIPTION` | `CLIENT_PAYMENT` |
| domain module | `src/features/billing/` | `src/features/payments/` |

### Connected accounts

`PayoutAccount` (one per tenant) holds `providerAccountId`, a mapped
`PayoutAccountStatus`, `chargesEnabled` / `payoutsEnabled` and the raw Stripe
`requirements`. `mapAccountStatus()` derives the status from
charges/payouts/requirements (pure, unit-tested). Onboarding = `accounts.create`
(Express) + `accountLinks.create`; status refresh via `accounts.retrieve` or the
`account.updated` webhook.

### Client payments

`createPaymentLink()` requires `chargesEnabled`, writes a `PaymentLink` row, then
creates a **Checkout Session on the connected account** with an
`application_fee_amount` = `round(amount * PLATFORM_FEE_BPS / 10_000)`. The
returned URL is the link. `checkout.session.completed` (Connect webhook) marks
the link PAID and writes a `Payment` with `platformFeeCents` / `netCents`,
de-duped on the payment-intent id. Booking payments (Slice 9) reuse the same
path with an `appointmentId` in the metadata.

### Refunds

`refundClientPayment()` (tenant-scoped) → `refunds.create(charge)`, then updates
`Payment.refundedCents` + status. The `charge.refunded` webhook does the same,
so a refund initiated in the Stripe dashboard is also reflected.

### PaymentProvider abstraction holds

All Connect calls go through `PaymentProvider` (`createConnectOnboarding`,
`getConnectAccountStatus`, `createOneOffCheckout`,
`createClientSubscriptionCheckout`, `refund`, `verifyWebhook(…, "connect")`).
Adding Mercado Pago later = a second implementation + a second connect webhook
route mapping to the same `src/features/payments/*` handlers.

### Config-gated

`isConfigured.stripeConnect` toggles the feature. Off: `/payments` renders,
actions are disabled, the connect webhook ACKs 200 and records nothing. No
payment is ever simulated. Setup: `docs/deployment/stripe-connect.md`.

## Consequences

- Client **subscriptions** need a recurring Price on each connected account —
  the checkout call + `Subscription.scope = CLIENT` + webhook mapping exist, but
  per-barbershop product/price creation is a follow-up.
- `PLATFORM_FEE_BPS` is a single global env value; a per-plan or per-tenant fee
  would be a schema addition on `Tenant` / `Plan`.
