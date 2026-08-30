# Stripe setup (SaaS subscription billing)

This is the **platform** account flow — barbershops paying you for the SaaS.
Client → barbershop payments (Stripe Connect) are in `stripe-connect.md`.

Until the keys below are set, `/pricing` and `/billing` render, but checkout,
the customer portal and webhooks are inert (the endpoint ACKs 200 and does
nothing). **No payment is ever simulated.**

## 1. Create the products/prices in Stripe

For each plan (`starter`, `pro`, `scale`) create a Product with a recurring
monthly Price and, optionally, a yearly Price. Copy the `price_...` ids.

## 2. Put the price ids on the Plan rows

```sql
UPDATE "Plan" SET "stripePriceId" = 'price_month_xxx',
                  "stripePriceIdYearly" = 'price_year_xxx'
WHERE code = 'pro';
```

(or via Prisma Studio / a one-off script). `startCheckout` throws
`PLAN_NOT_IN_STRIPE` if the chosen interval's price id is missing — the
onboarding flow then falls back to the free trial.

## 3. Environment variables

| Var | Where | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Key Vault → Container App secret | `sk_live_...` / `sk_test_...` |
| `STRIPE_PUBLISHABLE_KEY` | env | `pk_...` (not currently used server-side; kept for future embedded checkout) |
| `STRIPE_WEBHOOK_SECRET` | Key Vault | from the webhook endpoint you create in step 4 |

`isConfigured.stripe` is true only when `STRIPE_SECRET_KEY` **and**
`STRIPE_WEBHOOK_SECRET` are both set.

## 4. Webhook endpoint

In the Stripe Dashboard → Developers → Webhooks, add an endpoint:

```
https://<your-app>/api/webhooks/stripe
```

Subscribe to: `checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.paid`, `invoice.payment_succeeded`, `invoice.finalized`,
`invoice.created`, `invoice.payment_failed`.

Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

The handler is **idempotent**: a `WebhookEvent` row keyed on
`(provider, eventId)` is inserted before processing; duplicate deliveries return
`200 {duplicate:true}`. Handler failures return `500` so Stripe retries.

## 5. Customer portal

Enable the Billing customer portal in Stripe (Settings → Billing → Customer
portal) — allow plan switching, cancellation and payment-method updates.
`/billing` → "Manage payment" opens it via `billingPortal.sessions.create`.

## 6. Test locally

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the whsec_... it prints into STRIPE_WEBHOOK_SECRET, restart the app
stripe trigger checkout.session.completed
stripe trigger invoice.payment_failed
```

Then verify in the DB: a `Subscription` row appears/updates, `Tenant.status`
tracks it, `Invoice` + `Payment` rows are written on `invoice.paid`, and a
failed payment moves the subscription to `PAST_DUE` with a 7-day
`gracePeriodEndsAt`.

## What the app does with each state

| Stripe status | our `Subscription.status` | `Tenant.status` | access |
|---|---|---|---|
| `trialing` | TRIALING | ACTIVE | full (plan limits apply) |
| `active` | ACTIVE | ACTIVE | full |
| `past_due` | PAST_DUE | PAST_DUE | full during 7-day grace, then blocked |
| `canceled` / `unpaid` | CANCELED / UNPAID | CANCELED | blocked (read still works; writes gated) |

Plan limits (`Plan.limits` JSON) are enforced server-side at action time via
`assertWithinLimit` / `assertFeature` (`src/features/billing/gate.ts`).
