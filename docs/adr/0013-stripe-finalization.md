# ADR 0013 — Stripe integration finalization

**Status:** accepted · **Date:** 2026-09-07

## Context

The Stripe integration from Slices 5–6 (ADR 0003 / 0006 / 0007) was structurally
complete but not production-finalised: plan Stripe ids were manual-only, an
upgrade/downgrade from the pricing UI created a second subscription, Connect
webhooks trusted `metadata.tenantId` without checking `event.account`, there was
no Stripe Tax path, and financial logs were ad-hoc. The Stripe MCP /
`stripe_implementation_planner` was requested but is **not reachable in this
non-interactive environment** (no OAuth) — the work was done against the official
`stripe` SDK (already pinned, `apiVersion 2025-02-24.acacia`) and the existing
architecture, changing nothing that already worked.

## Decisions

1. **`Plan.stripeProductId`** added. One Stripe Product per plan carries the
   monthly + yearly Prices. Migration `20260907000000_stripe_plan_product`.

2. **`npm run stripe:sync-plans`** (`scripts/stripe/sync-plans.ts`) creates /
   updates the Stripe Product + Prices from the `Plan` rows and writes the ids
   back. Immutable-price aware (new price + archive old). **Refuses a live key
   without `--allow-live`** — production prices are never created implicitly.
   This is the "provide the key and go" enabler; the Dashboard route still works.

3. **Upgrade / downgrade in place.** `startCheckoutAction` now calls
   `changePlan()` first: a tenant with a live `providerSubId` gets
   `subscriptions.update({ items:[{id,price}], proration_behavior:
   "create_prorations" })` — no second subscription. A tenant still on the trial
   (no `providerSubId`) falls through to a fresh Checkout. The
   `customer.subscription.updated` webhook remains the source of truth.

4. **Connect webhook `event.account` verification.** `verifyWebhook` now
   surfaces `event.account`; `handleConnectEvent(event, account)` asserts it
   matches the tenant's `PayoutAccount.providerAccountId` before writing money,
   and drops any `appointmentId` / `customerId` in metadata that isn't that
   tenant's. Defence in depth on top of the signature check.

5. **More lifecycle events.** Platform webhook now also handles
   `customer.subscription.resumed` (→ resync) and `charge.refunded` (→ mark the
   SaaS `Payment` refunded). `invoice.paid` is now idempotent on the invoice
   (a replay writes no second ledger row).

6. **Idempotency keys on outbound calls.** `accounts.create` (per tenant),
   `checkout.sessions.create` (per tenant+price / per PaymentLink),
   `refunds.create` (per charge+amount).

7. **Stripe Tax, opt-in.** `STRIPE_TAX_ENABLED` (env, default off). When set,
   SaaS Checkout gets `automatic_tax` + `billing_address_collection: required` +
   `tax_id_collection` + `customer_update: { address, name }`. Off until the
   merchant configures tax registrations — the app invents no tax rules.
   `isConfigured.stripeTax` exposes the state.

8. **Invoicing.** Flow A already produces `Invoice` rows from `invoice.*`
   webhooks (`scope = PLATFORM`). Flow B one-off Checkout gains an opt-in
   `withInvoice` → Stripe `invoice_creation` so the barbershop's client can get
   a receipt/invoice. The two contexts stay separated by `Invoice.scope`.

9. **Structured financial logging.** `src/server/payments/log.ts`
   `logFinancialEvent(msg, fields, level)` — carries the correlation set (Stripe
   event id, internal + Stripe customer/payment/subscription/invoice ids,
   amount, currency, status) and **allowlists** its fields so a stray secret
   can't be logged. Used by both webhook handlers.

## Consequences

- `PaymentProvider` gained `updateSubscriptionPrice` and three optional input
  fields (`idempotencyKey`, `withInvoice`, `customerEmail`); the abstraction is
  otherwise unchanged and still the only Stripe-aware surface.
- Per-tenant / per-plan platform fees, client subscriptions with
  per-barbershop Prices, Connect-side automatic tax, and scheduled-campaign-style
  proactive dunning e-mails remain follow-ups (unchanged from ADR 0007).
- The `stripe_implementation_planner` was unavailable; if it becomes reachable
  later, re-run it against this integration as a review pass — no rework is
  expected.
