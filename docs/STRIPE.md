# Stripe integration

One integration, **two money flows that never mix** (ADR 0003 / 0006 / 0007 /
0013):

| | Flow A — SaaS subscription | Flow B — client → barbershop |
|---|---|---|
| Who pays whom | barbershop → platform | client → barbershop |
| Stripe account | platform | connected (Express) account |
| Stripe product | **Billing** (Products/Prices/Subscriptions/Invoices) | **Payments** + optional **Invoicing** |
| Domain module | `src/features/billing/` | `src/features/payments/` |
| Webhook route | `/api/webhooks/stripe` | `/api/webhooks/stripe/connect` |
| Signing secret | `STRIPE_WEBHOOK_SECRET` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| `WebhookEvent.provider` | `stripe` | `stripe_connect` |
| `Payment.purpose` | `SAAS_SUBSCRIPTION` | `CLIENT_PAYMENT` |
| `Invoice.scope` | `PLATFORM` | `CLIENT` |

Everything goes through the `PaymentProvider` abstraction
(`src/server/payments/`). No other module imports the Stripe SDK. Adding another
processor = a new `PaymentProvider` implementation + a webhook route; the
`Payment` / `Subscription` / `Invoice` logic is provider-neutral.

---

## Stripe products used

| Stripe product | Used for | Where |
|---|---|---|
| **Payments** (Checkout) | subscription checkout (flow A), one-off client checkout (flow B) | `checkout.sessions.create` |
| **Billing** | plans, prices, subscriptions, dunning, customer portal | `subscriptions.*`, `billingPortal.sessions.*` |
| **Connect** (Express) | barbershops receive from their clients | `accounts.create`, `accountLinks.create` |
| **Invoicing** | flow A invoices via `invoice.*` webhooks; flow B optional receipt via Checkout `invoice_creation` | `Invoice` model, webhooks |
| **Tax** | optional — `automatic_tax` on SaaS checkout when `STRIPE_TAX_ENABLED` | `checkout.sessions.create` |

Not used: **Radar** rules (defaults apply), **Terminal**, **Issuing**,
**Sigma**, the OAuth Connect flow (`STRIPE_CONNECT_CLIENT_ID` — Express + Account
Links needs no OAuth client id).

---

## Environment variables

| Var | Flow | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | both | `sk_test_…` in dev/staging, `sk_live_…` in prod only |
| `STRIPE_PUBLISHABLE_KEY` | — | not used server-side; kept for a future embedded checkout |
| `STRIPE_WEBHOOK_SECRET` | A | from the platform webhook endpoint |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | B | from the **Connect** webhook endpoint (separate) |
| `STRIPE_TAX_ENABLED` | A | `true` to enable Stripe Tax on SaaS checkout — requires tax registrations configured in the Stripe Dashboard first. Default off. |
| `PLATFORM_FEE_BPS` | B | application fee per client payment, basis points (`200` = 2 %) |
| `STRIPE_PRICING_TABLE_ID` | — | optional Stripe-hosted pricing-table embed id (the app renders its own) |

`isConfigured.stripe` = secret + platform webhook secret both set.
`isConfigured.stripeConnect` = secret + connect webhook secret both set.
`isConfigured.stripeTax` = secret set **and** `STRIPE_TAX_ENABLED=true`.

Per environment:

| | dev | staging | prod |
|---|---|---|---|
| key | `sk_test_…` (your test key) | `sk_test_…` (a shared test key) | `sk_live_…` |
| webhook URL A | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` | `https://staging.app/api/webhooks/stripe` | `https://app/api/webhooks/stripe` |
| webhook URL B | `stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe/connect` | `https://staging.app/api/webhooks/stripe/connect` | `https://app/api/webhooks/stripe/connect` |
| Tax | off | off (unless testing) | on once registrations exist |

Secrets live in **Azure Key Vault**, referenced by the Container Apps as
`secretRef`. Never in Git, never in the image. CI (`ci.yml`) does not need Stripe
keys — the integration tests feed synthetic events straight to the handlers.

---

## Flow A — SaaS Billing

### Plans are data

`Plan` rows carry `priceCents` / `priceCentsYearly`, `currency`, `trialDays`,
`limits` JSON, and the Stripe ids: `stripeProductId`, `stripePriceId`
(monthly), `stripePriceIdYearly`. **No price or Stripe id is hard-coded in a
component.** Seed (`npm run db:seed`) creates 3 plans (`starter` / `pro` /
`scale`) with BRL prices and null Stripe ids.

### Creating the Stripe Products/Prices — `npm run stripe:sync-plans`

```bash
# TEST mode — export a test key first
STRIPE_SECRET_KEY=sk_test_xxx npm run stripe:sync-plans
STRIPE_SECRET_KEY=sk_test_xxx npm run stripe:sync-plans -- --dry-run
STRIPE_SECRET_KEY=sk_test_xxx npm run stripe:sync-plans -- --only=pro
# LIVE mode is refused unless you explicitly opt in:
STRIPE_SECRET_KEY=sk_live_xxx npm run stripe:sync-plans -- --allow-live
```

For each `Plan` it creates/updates one Stripe **Product** (tax code
`txcd_10103001` — SaaS, overridable with `--tax-code=`), a recurring **monthly
Price**, and a **yearly Price** when `priceCentsYearly` is set, then writes the
ids back to the row. Stripe Prices are immutable, so a changed amount creates a
new Price and archives the old one. The script **refuses a live key** without
`--allow-live` — it never silently creates production prices.

If you prefer the Dashboard: create the Products/Prices by hand and paste the
ids onto the `Plan` rows (Prisma Studio or SQL).

### Checkout, trial, upgrade/downgrade, portal

- **New subscription**: `/pricing` or `/billing` → `startCheckoutAction` →
  `startCheckout` → `checkout.sessions.create` (`mode: subscription`,
  `client_reference_id = tenantId`, `trial_period_days` from the plan, an
  idempotency key per `tenant+price`). On completion the webhook sets
  `Tenant.stripeCustomerId`.
- **Upgrade / downgrade**: if the tenant already has a live subscription,
  `startCheckoutAction` calls `changePlan` → `subscriptions.update` with the new
  price and `proration_behavior: "create_prorations"` — **no second
  subscription**. The customer portal also allows switching; both routes are
  re-synced by `customer.subscription.updated`.
- **Customer Portal**: `/billing` → "Manage payment" →
  `billingPortal.sessions.create`. Enable it in Stripe → Settings → Billing →
  Customer portal (allow plan switch, cancellation, payment-method update).

### Webhooks (platform)

Endpoint `POST /api/webhooks/stripe`. Subscribe to:

`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.resumed`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`,
`invoice.finalized`, `invoice.created`, `invoice.payment_failed`,
`charge.refunded`.

| Event | Effect |
|---|---|
| `checkout.session.completed` (subscription) | store `Tenant.stripeCustomerId` |
| `customer.subscription.created / updated / resumed` | upsert `Subscription` (status, period, plan by price id, interval); mirror onto `Tenant.status` |
| `customer.subscription.deleted` | `Subscription` + `Tenant` → CANCELED |
| `invoice.created / finalized` | upsert `Invoice` (OPEN) |
| `invoice.paid / payment_succeeded` | `Invoice` → PAID; **one** `Payment` (`SAAS_SUBSCRIPTION`, idempotent on the invoice); clears a PAST_DUE state |
| `invoice.payment_failed` | `Subscription` → PAST_DUE + 7-day `gracePeriodEndsAt`; `Tenant` → PAST_DUE |
| `charge.refunded` | mark the SaaS `Payment` REFUNDED / PARTIALLY_REFUNDED |

Idempotency: a `WebhookEvent` row unique on `(provider, eventId)` is inserted
**before** processing — a duplicate delivery returns `200 {duplicate:true}`.
Handler failure → `500` so Stripe retries. Events out of order are safe: status
is always taken from the latest `customer.subscription.*`, invoices are upserted
by `providerInvoiceId`, the `Payment` row is idempotent on the invoice.

### Plan gating

`src/features/billing/gate.ts` — `getEntitlements`, `assertWithinLimit`,
`assertFeature` throw `PlanLimitError`. A tenant with no subscription uses
`TRIAL_LIMITS` and is blocked once `Tenant.trialEndsAt` passes. The public
booking flow and the chatbot call the **same** gate — the AI can never exceed a
limit the owner couldn't.

---

## Flow B — Stripe Connect

### Onboarding

Owner → `/[locale]/payments` → **Connect Stripe account**:

1. `accounts.create` (`type: express`, `country` from the tenant, idempotency
   key per tenant) → `PayoutAccount.providerAccountId`.
2. `accountLinks.create` (`type: account_onboarding`, `refresh_url` /
   `return_url` back to `/payments`) → redirect to Stripe's hosted onboarding.
3. On return, "Refresh status" (or the `account.updated` webhook) →
   `accounts.retrieve` → `mapAccountStatus()` →
   `NOT_CONNECTED → ONBOARDING → PENDING_VERIFICATION → ENABLED`
   (`RESTRICTED` / `DISABLED` on problems). **An account is only usable when
   `chargesEnabled` is true** — never assumed from creation.

### Client payments

`createPaymentLink()` (`payment.link.create` permission) requires an ENABLED
account, writes a `PaymentLink`, then `checkout.sessions.create` **on the
connected account** with `application_fee_amount = round(amount *
PLATFORM_FEE_BPS / 10_000)`, an idempotency key = the `PaymentLink` id, and
optionally `invoice_creation` (`withInvoice`) so the client gets a Stripe
receipt/invoice. The URL is the link — it can be sent later by WhatsApp / e-mail
(messaging is a separate, independently gated integration; nothing is sent
automatically if it is not configured).

Booking payments (public page, chatbot) reuse the same path with an
`appointmentId` in the metadata; the webhook confirms the appointment on
payment.

### Webhooks (Connect)

Endpoint `POST /api/webhooks/stripe/connect` — check **"Listen to events on
Connected accounts"**. Subscribe to: `account.updated`,
`checkout.session.completed`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `charge.refunded`.

| Event | Effect |
|---|---|
| `account.updated` | re-map + persist `PayoutAccount` status / `chargesEnabled` / `payoutsEnabled` / `requirements` |
| `checkout.session.completed` (paid) | verify `event.account` == the tenant's `PayoutAccount`; drop any cross-tenant `appointmentId`/`customerId` in metadata; mark `PaymentLink` PAID; write `Payment` (`CLIENT_PAYMENT`, `platformFeeCents`, `netCents`), idempotent on the payment-intent id; auto-confirm a PENDING booking |
| `payment_intent.succeeded` | backfill `Payment.providerChargeId` (needed for refunds) |
| `payment_intent.payment_failed` | mark a pending `Payment` FAILED (+ `failureCode`) |
| `charge.refunded` | update `Payment.refundedCents` + status |

### Refunds

`refundClientPayment(tenantId, paymentId, amount?)` — tenant-scoped,
`refunds.create(charge)` with an idempotency key, then update the row. The
`charge.refunded` webhook does the same, so a Dashboard refund is reflected too.

### Client subscriptions (recurring "corte mensal")

`createClientSubscriptionCheckout` is wired (`Subscription.scope = CLIENT`,
`application_fee_percent`, webhook mapping). It needs a **recurring Price
created on the connected account** — creating those per barbershop is a
follow-up.

---

## Stripe Tax

International SaaS. Set `STRIPE_TAX_ENABLED=true` **after** you have:

1. added your company's tax registrations in Stripe → Tax → Registrations
   (this is a fiscal decision — the app does not invent tax rules), and
2. set an origin address and product tax codes (the `sync-plans` script sets
   `txcd_10103001` on each plan Product).

Then SaaS Checkout gets `automatic_tax: { enabled: true }`,
`billing_address_collection: "required"`, `tax_id_collection: { enabled: true }`
and `customer_update: { address: "auto", name: "auto" }` for renewals. Country /
customer location / address / currency all come from what Stripe collects at
checkout — the app stores nothing tax-specific.

Connect (flow B) tax is the **barbershop's** responsibility on its own connected
account; enabling `automatic_tax` there is a per-tenant follow-up and is not
turned on by this flag.

---

## Idempotency

- **Webhooks**: `WebhookEvent @@unique([provider, eventId])` inserted before
  processing; duplicates are a 200 no-op. Handlers also guard on state and
  de-dupe on `Payment.providerIntentId` (`@@unique`) and on the invoice.
- **Outbound Stripe calls**: idempotency keys on `accounts.create` (per tenant),
  `checkout.sessions.create` (per tenant+price / per PaymentLink) and
  `refunds.create` (per charge+amount) — a double-submitted action never creates
  a duplicate Stripe object or a double refund.

## Security

- Secret key server-side only; never in a client bundle or the repo.
- No card data stored — Stripe holds it (SAQ-A).
- Webhook signature verified before any processing; the Connect webhook also
  checks `event.account` against the tenant's connected account.
- The server determines tenant / customer / product / price / amount / currency
  / appointment / connected account. A price or amount from the browser is never
  trusted (subscription checkout uses the plan's `stripePriceId`; one-off
  amounts are re-validated server-side and are ≥ 1.00).
- A tenant can never read or refund another tenant's payments
  (`refundClientPayment` is tenant-scoped; cross-tenant metadata ids are
  dropped).
- Structured financial logs (`logFinancialEvent`) carry the correlation set
  (Stripe event id, tenant id, internal + Stripe customer/payment/subscription
  ids) and **allowlist** their fields — a stray secret can't be logged. Never
  logged: secret keys, full card data, CVV, tokens.

---

## Test Mode checklist

With a `sk_test_` key and `stripe listen` running:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe/connect
STRIPE_SECRET_KEY=sk_test_xxx npm run stripe:sync-plans
```

Cards: `4242 4242 4242 4242` (ok), `4000 0000 0000 0002` (declined),
`4000 0000 0000 9995` (insufficient funds). Full list:
<https://stripe.com/docs/testing>.

| Check | How |
|---|---|
| Subscription checkout | `/pricing` → subscribe → DB `Subscription` ACTIVE, `Tenant.status` ACTIVE |
| Trial | plan `trialDays` > 0 → `Subscription` TRIALING, `currentPeriodEnd` set |
| Upgrade / downgrade | `/billing` → change plan → `subscriptions.update`, webhook re-syncs the plan |
| Payment failed | `stripe trigger invoice.payment_failed` → PAST_DUE + 7-day grace |
| Subscription canceled | portal cancel or `stripe trigger customer.subscription.deleted` → CANCELED, tenant blocked |
| Duplicate webhook | replay any event → `200 {duplicate:true}`, no second row |
| Connect onboarding | `/payments` → connect → complete test onboarding → status ENABLED |
| Payment link | `/payments` → create link → pay with `4242…` → `Payment` with `platformFeeCents` / `netCents` |
| Refund | `/payments` → refund → `charge.refunded` updates the row |
| Invoice | `invoice.paid` → `Invoice` PAID + `Payment` row; `withInvoice` link → Stripe receipt |
| Plan gating | exceed `maxEmployees` on the trial → `PlanLimitError` |
| Cross-tenant | tenant B cannot refund tenant A's payment (`NotFoundError`) |

---

## Going live

1. Swap `STRIPE_SECRET_KEY` to `sk_live_…` in the prod Key Vault.
2. `STRIPE_SECRET_KEY=sk_live_… npm run stripe:sync-plans -- --allow-live`
   (or create prod Products/Prices in the Dashboard and paste the ids).
3. Create the two **live** webhook endpoints (platform + Connect) at the prod
   URLs; put the signing secrets in Key Vault.
4. Enable the live Customer Portal.
5. If charging tax: add live tax registrations, then set `STRIPE_TAX_ENABLED=true`.
6. Connect: complete platform profile, branding, support email, statement
   descriptor in live mode.
7. Verify `/api/health` is `healthy` and run the Test Mode checklist once against
   live with a real card you control, then refund it.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| checkout button shows "configure Stripe" | `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` unset (`isConfigured.stripe` false) |
| `PLAN_NOT_IN_STRIPE` on checkout | the plan has no `stripePriceId` for that interval — run `stripe:sync-plans` |
| webhook 400 "invalid signature" | wrong `STRIPE_WEBHOOK_SECRET` (platform vs Connect mixed up), or a proxy altered the body |
| webhook 500, Stripe retrying | handler threw — check logs by `x-request-id`; the `WebhookEvent` row has `status: failed` + `error` |
| subscription not updating | the price id on the event doesn't match any `Plan.stripePriceId*` → `Subscription.planId` stays null; re-run `sync-plans` |
| Connect "account not ready" | `chargesEnabled` still false — finish onboarding / clear `requirements` |
| `account does not match tenant` in logs | a Connect event fired for an account this tenant doesn't own — investigate, do not disable the check |
| double subscription created | should not happen post-fix — `changePlan` updates in place; report if seen |
