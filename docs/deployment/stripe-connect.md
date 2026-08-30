# Stripe Connect setup (client → barbershop payments)

> **The full reference is [../STRIPE.md](../STRIPE.md).** This file is the short
> setup checklist for flow B.

This flow is **completely separate** from the SaaS subscription billing
(`stripe.md`): different money movement, different webhook endpoint, different
signing secret, different `Payment.purpose` (`CLIENT_PAYMENT` vs
`SAAS_SUBSCRIPTION`). They are never mixed. `STRIPE_CONNECT_CLIENT_ID` is **not**
needed — this uses Express accounts + Account Links, not the OAuth connect flow.

## 1. Enable Connect

Stripe Dashboard → Connect → get started. Use **Express** accounts. Set your
platform branding, support email and the statement descriptor.

## 2. Environment variables

| Var | Where | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | (shared with `stripe.md`) | your platform key |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Key Vault → Container App secret | from the **Connect** webhook endpoint (step 4) |
| `PLATFORM_FEE_BPS` | env | application fee on each client payment, in basis points. `200` = 2%. `0` = no fee. |

`isConfigured.stripeConnect` is true only when `STRIPE_SECRET_KEY` **and**
`STRIPE_CONNECT_WEBHOOK_SECRET` are both set. Until then `/payments` renders,
but "Connect account" and "Create link" are disabled and the Connect webhook
endpoint ACKs 200 without doing anything.

## 3. Onboarding a barbershop

Barbershop owner → `/[locale]/payments` → **Connect Stripe account**. The app:

1. creates an Express account (`accounts.create`, `type: "express"`,
   `country` from the tenant), stores its id on `PayoutAccount.providerAccountId`;
2. creates an Account Link (`accountLinks.create`, `type: "account_onboarding"`)
   and redirects the owner to Stripe's hosted onboarding;
3. on return, "Refresh status" (or the `account.updated` webhook) calls
   `accounts.retrieve` and maps the result to `PayoutAccountStatus`
   (`NOT_CONNECTED` → `ONBOARDING` → `PENDING_VERIFICATION` → `ENABLED`, plus
   `RESTRICTED` / `DISABLED`).

Payment links can only be created once `chargesEnabled` is true.

## 4. Connect webhook endpoint

Dashboard → Developers → Webhooks → **Add endpoint** → check **"Listen to events
on Connected accounts"**:

```
https://<your-app>/api/webhooks/stripe/connect
```

Subscribe to: `account.updated`, `checkout.session.completed`,
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.

Copy the signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`. Idempotent via
`WebhookEvent` unique `(provider = "stripe_connect", eventId)`.

## 5. What each event does

| Event | Effect |
|---|---|
| `account.updated` | re-map + persist `PayoutAccount` status / `chargesEnabled` / `payoutsEnabled` / `requirements` |
| `checkout.session.completed` (paid) | verify `event.account` matches the tenant's connected account; drop any cross-tenant `appointmentId`/`customerId` in metadata; mark the `PaymentLink` PAID; create a `Payment` (`CLIENT_PAYMENT`, `SUCCEEDED`, `platformFeeCents`, `netCents`), linked to the appointment/customer if known; de-duped on the payment-intent id; auto-confirm a PENDING booking |
| `payment_intent.succeeded` | backfill `Payment.providerChargeId` (needed for refunds) |
| `payment_intent.payment_failed` | mark a pending `Payment` FAILED |
| `charge.refunded` | update `Payment.refundedCents` + status (`PARTIALLY_REFUNDED` / `REFUNDED`) |

## 6. Client subscriptions (recurring "plan corte mensal")

`createClientSubscriptionCheckout` is wired in the `PaymentProvider`. It needs a
**recurring Price created on the connected account** (id passed in). Creating
those products/prices per barbershop is a follow-up; the plumbing (schema
`Subscription.scope = CLIENT`, checkout call, webhook mapping) is in place.

## 7. Test locally

```bash
stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe/connect
# copy the whsec_... into STRIPE_CONNECT_WEBHOOK_SECRET, restart
```

Create a test Express account via the onboarding flow, mark it enabled in the
Stripe test dashboard, create a payment link from `/payments`, pay it with a
test card, and confirm a `Payment` row appears with the right
`platformFeeCents` / `netCents`. Then refund it from `/payments` and confirm the
`charge.refunded` webhook updates the row.
