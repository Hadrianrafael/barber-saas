# Go-live runbook

Everything in the code is done. This is the ordered list of what **you** do to
take the SaaS from `READY FOR CONFIGURATION` to selling. Do it once for
**staging**, verify, then repeat for **production**.

Legend: 🧑 = you (accounts / dashboards / DNS) · 🤖 = a command you run · ✅ = a
check.

**Checklist form (status / owner / command / validate):**
[`GO-LIVE-CHECKLIST.md`](GO-LIVE-CHECKLIST.md).

Related docs: [`STRIPE.md`](STRIPE.md) · [`deployment/azure.md`](deployment/azure.md) ·
[`deployment/environment-variables.md`](deployment/environment-variables.md) ·
[`deployment/keyvault.md`](deployment/keyvault.md) ·
[`deployment/domain.md`](deployment/domain.md) ·
[`deployment/backup-recovery.md`](deployment/backup-recovery.md) ·
[`AZURE-COST-CHECKLIST.md`](AZURE-COST-CHECKLIST.md) ·
[`SECURITY.md`](SECURITY.md) · [`V1-REPORT.md`](V1-REPORT.md).

**Helper scripts** (never print secrets): `npm run check:env` (which vars /
integrations are set), `npm run preflight` (Postgres / Redis / Blob / Stripe
connectivity), `npm run smoke -- <url>` (post-deploy HTTP checks),
`npm run keyvault:push -- --vault <kv> --file .env.<env>` (push secrets to Key
Vault), `npm run stripe:sync-plans` (Stripe Products/Prices from the DB).

---

## 1. Create the external accounts 🧑

| Service | Sign up | You need |
|---|---|---|
| **Azure** | portal.azure.com | a subscription + permission to create resource groups |
| **Stripe** | dashboard.stripe.com | account activated for your country; **Connect** enabled (Settings → Connect → Get started, Express) |
| **Resend** | resend.com | account + a domain you control for the sending address |
| **Meta / WhatsApp** | developers.facebook.com | a Meta app + a WhatsApp Business Account + a phone number |
| **Anthropic** | console.anthropic.com | API access (for the chatbot) |
| **GitHub** | (this repo) | Actions enabled; ability to add repo secrets + a `production` Environment with required reviewers |
| **Domain registrar** | wherever the domain lives | control of DNS for your SaaS domain |
| **Sentry** *(optional)* | sentry.io | a project DSN |

Keep every key in a password manager for now — they go into Azure Key Vault, never into Git.

---

## 2. Configure Stripe — SaaS Billing 🧑🤖

1. 🧑 Stripe → toggle **Test mode**. Developers → API keys → copy `sk_test_…` and `pk_test_…`.
2. 🧑 Developers → Webhooks → **Add endpoint** → `https://staging.<domain>/api/webhooks/stripe`
   → events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.resumed`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`,
   `invoice.finalized`, `invoice.created`, `invoice.payment_failed`,
   `charge.refunded`. Copy the signing secret `whsec_…`.
3. 🧑 Settings → Billing → **Customer portal** → enable; allow plan switch, cancellation, payment-method update.
4. 🤖 Create the Products/Prices from the DB (after the DB is migrated + seeded — step 8):
   ```bash
   STRIPE_SECRET_KEY=sk_test_xxx npm run stripe:sync-plans
   ```
5. ✅ `SELECT code, "stripeProductId", "stripePriceId" FROM "Plan";` — all populated.

Full detail + the state table: [`STRIPE.md`](STRIPE.md).

---

## 3. Configure Stripe Connect 🧑

1. 🧑 Stripe → Connect → set platform name, icon, support email, statement descriptor (test mode first).
2. 🧑 Developers → Webhooks → **Add endpoint** → check **"Listen to events on Connected accounts"**
   → `https://staging.<domain>/api/webhooks/stripe/connect`
   → events: `account.updated`, `checkout.session.completed`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `charge.refunded`. Copy the signing secret.
3. 🧑 Decide your platform fee → `PLATFORM_FEE_BPS` (e.g. `200` = 2%). `0` = no fee.
4. `STRIPE_CONNECT_CLIENT_ID` is **not used** — Express + Account Links needs no OAuth client id.

---

## 4. Configure Resend 🧑

1. 🧑 resend.com → API Keys → copy `re_…`.
2. 🧑 Domains → add your domain → create the SPF + DKIM DNS records it shows.
3. 🧑 Pick your sender → `EMAIL_FROM`, e.g. `"Barbearia SaaS <no-reply@yourdomain.com>"` (domain must be verified).
4. Without a key the app logs e-mails to stdout (`Message.provider = "console"`) — fine for a first smoke, but set the real key before selling.

---

## 5. Configure Meta / WhatsApp Cloud API 🧑

1. 🧑 Meta app → add **WhatsApp** → API Setup: copy the **Phone number ID**, the **WABA ID**, and a **permanent System User access token** with `whatsapp_business_messaging` + `whatsapp_business_management`.
2. 🧑 Meta app → Settings → Basic → copy the **App secret**.
3. 🧑 Invent a random `WHATSAPP_WEBHOOK_VERIFY_TOKEN` string.
4. 🧑 WhatsApp → Configuration → Webhook → callback `https://staging.<domain>/api/webhooks/whatsapp`, verify token = the string above, subscribe field **`messages`**.
5. 🧑 Submit **message templates** (pt-BR / en / es) for `appointment_confirmation`, `appointment_reminder`, `appointment_canceled`, `appointment_rescheduled`, `payment_link` — required for messages outside the 24h window.
6. Without keys: WhatsApp sends are recorded `FAILED` with a real backoff and the flow falls through to e-mail; nothing is simulated.

Detail: [`deployment/whatsapp.md`](deployment/whatsapp.md).

---

## 6. Configure the AI chatbot 🧑

1. 🧑 console.anthropic.com → API Keys → copy `sk-ant-…` → `ANTHROPIC_API_KEY`.
2. `CHATBOT_MODEL` defaults to `claude-sonnet-5`.
3. Each barbershop turns the bot on in **Settings → Chatbot**. Without a key every chat message goes to the human queue — never a faked reply.

Detail: [`deployment/chatbot.md`](deployment/chatbot.md).

---

## 7. Configure Azure infrastructure 🤖

Per environment (`staging`, then `prod`):

```bash
az group create -n barber-staging -l brazilsouth

# build the single image
az acr build -r <acr-name> -t barber-saas:$(git rev-parse --short HEAD) --file Dockerfile .

az deployment group create -g barber-staging -f infra/main.bicep \
  -p namePrefix=barber environment=staging \
     image=<acr>.azurecr.io/barber-saas:<tag> \
     pgAdminLogin=barberadmin pgAdminPassword='<generate a strong one>' \
     appUrl=https://staging.<your-domain>
```

Provisions: Log Analytics, ACR, Postgres Flexible Server 16, Azure Cache for
Redis, Storage + `uploads` container, Key Vault, Container Apps env, `-web`,
`-worker`, `-cron-reminders`, `-cron-retry`, `-migrate` (manual).
Names: `barber-staging-web`, `barber-prod-web`, etc.

`DATABASE_URL`, `REDIS_URL`, `AZURE_STORAGE_CONNECTION_STRING` are wired from the
provisioned resources automatically.

---

## 8. Configure Key Vault + first migration + seed 🤖

1. 🤖 Grant each Container App / Job **system-assigned identity** the
   `Key Vault Secrets User` role on `barber-<slug>-kv-…`.
2. 🤖 Put every secret value in Key Vault (names = the `secrets[]` entries in
   `infra/main.bicep`; where to get each = [`deployment/environment-variables.md`](deployment/environment-variables.md)):
   ```bash
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name auth-secret               --value "$(openssl rand -base64 48)"
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name stripe-secret-key         --value "sk_test_..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name stripe-webhook-secret     --value "whsec_..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name stripe-connect-webhook-secret --value "whsec_..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name resend-api-key            --value "re_..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name anthropic-api-key         --value "sk-ant-..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name whatsapp-phone-number-id  --value "..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name whatsapp-business-account-id --value "..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name whatsapp-access-token     --value "..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name whatsapp-webhook-verify-token --value "..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name whatsapp-app-secret       --value "..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name stripe-publishable-key    --value "pk_test_..."
   az keyvault secret set --vault-name barber-stg-kv-xxxx --name sentry-dsn                --value ""   # optional
   ```
3. 🤖 In `infra/main.bicep`, change each `secrets[]` entry from `value: ''` to
   `keyVaultUrl: '<vault-uri>/secrets/<name>'` + `identity: 'system'`, and
   re-run the `az deployment group create` from step 7.
4. 🤖 Also set the non-secret env values on the apps if you didn't in Bicep:
   `EMAIL_FROM`, `PLATFORM_FEE_BPS`, `STRIPE_TAX_ENABLED` (leave `false` for now).
5. 🤖 Run migrations + seed:
   ```bash
   az containerapp job start -g barber-staging -n barber-staging-migrate
   # then, once, against the staging DB (from your machine or a job):
   SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='<strong>' npm run db:seed
   ```
6. 🤖 Now do step 2.4 (`stripe:sync-plans`) against the staging DB.

---

## 9. Configure the custom domain 🧑

1. 🧑 Container Apps → `barber-<env>-web` → Custom domains → add `staging.<domain>` (and `app.<domain>` for prod) → follow the DNS validation (CNAME/TXT) + bind a **managed certificate** (HTTPS).
2. 🧑 Update `appUrl` in the Bicep params to the final HTTPS URL and redeploy so `APP_URL` is correct (links in e-mails, booking links, Stripe return URLs all use it).
3. HSTS is emitted in production automatically; CSP allows Stripe/Anthropic/Meta.
4. No CORS config needed — the app is same-origin; webhooks are server-to-server.
5. **Do not** change DNS for anything else automatically.

---

## 10. Point every webhook at the real URL 🧑

Re-open the endpoints created in steps 2, 3, 5 and set the URL to the final
domain (`https://staging.<domain>/api/webhooks/…` then `https://<domain>/…` for
prod). Each has its **own signing secret** — keep them straight:
`stripe-webhook-secret` ≠ `stripe-connect-webhook-secret`.

---

## 11. Deploy staging 🤖

After steps 7–10 the first deploy is already live. Subsequent deploys are
automatic on green `main` via `.github/workflows/deploy.yml` (build → migrate job
→ roll web/worker/jobs → readiness smoke). Add the repo secrets it needs:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (OIDC federated
credential), `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `APP_HEALTH_URL`
(`https://staging.<domain>/api/health`).

✅ `curl https://staging.<domain>/api/health` → `{"status":"healthy",...}`.

---

## 12. Test staging (Stripe Test Mode) 🧑🤖

Run **`stripe listen`** locally against staging isn't needed — the webhooks are
real. Use the Stripe Dashboard (Test mode) + test cards:

| # | Flow | Steps | ✅ Expected |
|---|---|---|---|
| 1 | Signup → plan → checkout | sign up, verify e-mail, onboard a barbershop, pick a plan, pay with `4242 4242 4242 4242` | webhook → `Subscription` ACTIVE, `/billing` shows active, `Invoice` + `Payment` rows |
| 2 | Trial | pick a plan without paying (or plan `trialDays` > 0) | `Subscription` TRIALING, dashboard usable, plan limits apply |
| 3 | Upgrade / downgrade | `/billing` → change plan | `subscriptions.update` (no 2nd subscription), webhook re-syncs |
| 4 | Payment failed | Stripe → the subscription → "Update to past due" / trigger `invoice.payment_failed` | `PAST_DUE` + 7-day grace; after grace, writes blocked |
| 5 | Cancel | portal cancel or trigger `customer.subscription.deleted` | CANCELED, tenant blocked (reads still work) |
| 6 | Duplicate webhook | resend any event from the Dashboard | `200 {duplicate:true}`, no second row |
| 7 | Connect onboarding | owner → `/payments` → connect → finish test onboarding | status ENABLED, `chargesEnabled` true |
| 8 | Payment link | `/payments` → create link → pay with `4242…` | `Payment` (`CLIENT_PAYMENT`) with `platformFeeCents` / `netCents` |
| 9 | Booking + pay | public page → service → barber → slot → data → pay | appointment PENDING → webhook → CONFIRMED; `Payment` linked |
| 10 | Refund | `/payments` → refund the payment | `charge.refunded` → row `REFUNDED` |
| 11 | Invoice | `invoice.paid` → `Invoice` PAID + `Payment`; `withInvoice` link → Stripe receipt |
| 12 | Plan gating | exceed `maxEmployees` for the plan | `PlanLimitError` surfaced |
| 13 | Declined card | pay with `4000 0000 0000 0002` | `payment_intent.payment_failed` → `Payment` FAILED |
| 14 | Comms | complete a booking | confirmation e-mail (real if Resend set, console otherwise); WhatsApp if opted-in + configured |
| 15 | Chatbot | open the widget on the public page, ask price/availability, book | tool-grounded answers, appointment `source = CHATBOT`, confirmation sent |
| 16 | Cross-tenant | as barbershop B, try B's `/loyalty` with a crafted customer id | rejected server-side |

Also run the automated suite against a throwaway DB:
```bash
RUN_DB_TESTS=1 npm test   # 186 tests incl. billing/connect/webhooks/booking/chatbot/isolation/golden-path
```

Test cards: <https://stripe.com/docs/testing>.

---

## 13. Deploy production 🤖

1. 🤖 Repeat steps 7–10 with `environment=prod`, a `prod` resource group, and
   `app.<domain>`. Use **`sk_test_…`** still — do not switch to live yet.
2. 🤖 Add the `production` GitHub Environment (required reviewers). Add its
   secrets (same names, prod values, `APP_HEALTH_URL` = prod).
3. 🤖 `GitHub → Actions → Deploy → Run workflow → environment: production`.
4. ✅ Run the smoke subset of step 12 against prod-with-test-keys.

---

## 14. Switch Stripe to Live Mode 🧑🤖

1. 🧑 Stripe → toggle **off** Test mode. Complete live activation (business
   details, bank account, tax settings).
2. 🧑 Create the **two live webhook endpoints** (platform + Connect) at the prod
   URLs; copy the new `whsec_…` values.
3. 🧑 Live Customer Portal → enable.
4. 🧑 Connect (live) → platform profile, branding, statement descriptor.
5. 🤖 Put the **live** `sk_live_…`, `pk_live_…`, and the two live `whsec_…` in
   the prod Key Vault (overwrite the test values); redeploy so the apps pick
   them up.
6. 🤖 Create live Products/Prices:
   ```bash
   STRIPE_SECRET_KEY=sk_live_xxx npm run stripe:sync-plans -- --allow-live
   ```
7. 🧑 *(optional, international tax)* Stripe → Tax → add your registrations, then
   set `STRIPE_TAX_ENABLED=true` on the prod web app and redeploy.
8. ✅ Do one real end-to-end purchase with a card you own, then refund it.

---

## 15. Final checklist ✅

Copy this into your launch ticket. Tick each in **staging** first, then **prod**.

```
Stripe
[ ] Stripe account activated for the country
[ ] Test Mode verified end to end (step 12 table)
[ ] Products created (Plan.stripeProductId populated)
[ ] Prices created (monthly + yearly, Plan.stripePriceId* populated)
[ ] Billing: checkout / trial / upgrade / downgrade / cancel / renewal / dunning / portal
[ ] Connect: Express onboarding → ENABLED, charges_enabled true
[ ] Webhooks: platform + connect endpoints, correct signing secrets, idempotent
[ ] Stripe Tax: registrations added (if charging tax) then STRIPE_TAX_ENABLED=true
[ ] Invoicing: SaaS Invoice rows (scope=PLATFORM) + optional client receipt

Integrations
[ ] Resend: domain verified (SPF+DKIM), EMAIL_FROM set, test e-mail delivered
[ ] WhatsApp: phone number id / WABA id / token / app secret / verify token set
[ ] WhatsApp: webhook verified, `messages` subscribed, templates approved
[ ] AI: ANTHROPIC_API_KEY set, a barbershop enabled the chatbot, tool-grounded reply verified

Azure
[ ] Resource group per environment (staging, prod)
[ ] PostgreSQL Flexible Server 16 reachable, backups + (prod) geo-redundant + HA
[ ] Azure Cache for Redis reachable (rediss://)
[ ] Storage account + `uploads` container; upload of a logo works
[ ] Key Vault: all secrets set, Container Apps identities have Secrets User
[ ] ACR: image `barber-saas:<tag>` pushed
[ ] Container App -web: running, ingress bound, /api/health = healthy
[ ] Container App -worker: running (BullMQ consuming)
[ ] Jobs -cron-reminders (*/15) and -cron-retry (*/5) scheduled
[ ] Job -migrate ran; `prisma migrate status` clean
[ ] `npm run db:seed` ran once (3 plans + super admin)

Delivery
[ ] Custom domain bound, HTTPS managed cert, APP_URL correct
[ ] HSTS present in prod; CSP not blocking Stripe/Anthropic/Meta
[ ] CI (ci.yml) green on main
[ ] deploy.yml: repo secrets set; staging auto-deploy works; production gated

Quality
[ ] Monitoring: Log Analytics receiving app logs; x-request-id correlation
[ ] Automated tests green (RUN_DB_TESTS=1 npm test) — 186
[ ] E2E golden path passed (manual, step 12 #1/#9/#15)
[ ] Security review items closed (docs/SECURITY.md) — cross-tenant, webhooks, RBAC, headers
[ ] One real production purchase with a live card, then refunded

Go
[ ] Stripe Live Mode active
[ ] Live webhooks verified with a live event
[ ] Start selling
```

---

## What still depends on you vs. what is done

**Done in code — nothing to build:**
all product features (Slices 0–11), Stripe Billing + Connect + Payments +
Invoicing + Tax (opt-in), Resend + WhatsApp Cloud API + Anthropic integrations
(env-gated, never simulated), multi-tenancy + RBAC + the cross-tenant isolation
guards and test suite, the scheduling domain shared by dashboard/public/chatbot,
BullMQ worker + two scheduled jobs, observability (structured logs, request ids,
liveness/readiness), CI + deploy pipeline, the Azure Bicep (all resources + every
secret slot wired), the Dockerfile (one image, three roles), the
`stripe:sync-plans` tool, and all documentation.

**Depends on you — accounts, secrets, DNS, deploy:**
create the seven external accounts (§1), obtain and store every credential in
Key Vault (§2–§8), bind the custom domain + HTTPS (§9), create the webhook
endpoints (§10), run the deploys (§11, §13), execute the Test-Mode checklist
(§12, §15), then flip Stripe to Live Mode (§14). No code change is required for
any of it.
