# Environment variables

Validated at boot by `src/env.ts` (the process refuses to start on an invalid
required var). Integration blocks may be empty — `isConfigured.*` gates the
feature and it degrades cleanly (never simulates success).

## Required

| Var | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/barber` | pooled connection |
| `DIRECT_DATABASE_URL` | same, non-pooled | migrations |
| `REDIS_URL` | `rediss://…:6380` | sessions, rate limit, BullMQ |
| `AUTH_SECRET` | 32+ random chars | session/token hashing |
| `APP_URL` | `https://app.example.com` | absolute links (booking, payment) |

## Optional (env-gated integrations)

| Var | Feature when set |
|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM` | real e-mail (else console transport) — `docs/deployment/resend.md` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | SaaS subscription billing — `docs/STRIPE.md` |
| `STRIPE_TAX_ENABLED` | `true` enables Stripe Tax on SaaS checkout (needs tax registrations set up in Stripe first) — default off |
| `STRIPE_CONNECT_WEBHOOK_SECRET`, `PLATFORM_FEE_BPS` | client → barbershop payments — `docs/STRIPE.md` |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API — `docs/deployment/whatsapp.md` |
| `ANTHROPIC_API_KEY`, `CHATBOT_MODEL` | AI chatbot (else every chat message queues for a human) — `docs/deployment/chatbot.md` |
| `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`, `STORAGE_PUBLIC_URL` | Azure Blob uploads (else local disk, dev only) |
| `SENTRY_DSN` | error reporting |
| `LOG_LEVEL` | `info` default; `silent` in tests |

## Other

| Var | Default |
|---|---|
| `SESSION_TTL_SECONDS` | 30 days |
| `ADMIN_SESSION_TTL_SECONDS` | 12 h |
| `APP_LOCALES` | `pt-BR,en,es` |
| `APP_DEFAULT_LOCALE` | `pt-BR` |

## Per environment

Nothing sensitive is shared between environments.

| | development | staging | production |
|---|---|---|---|
| source | `.env` (git-ignored) | Azure Key Vault `barber-stg-kv-…` | Azure Key Vault `barber-prd-kv-…` |
| DB / Redis / Storage | `docker compose` locals | derived by Bicep from the provisioned resources | same |
| Stripe keys | `sk_test_…` | `sk_test_…` | `sk_live_…` (only after §14 of GO-LIVE) |
| Stripe webhooks | `stripe listen` | staging endpoints | production endpoints |
| `STRIPE_TAX_ENABLED` | `` (off) | `` (off) | `true` only after tax registrations exist |
| `APP_URL` | `http://localhost:3000` | `https://staging.<domain>` | `https://<domain>` |
| `LOG_LEVEL` | `info` (or `debug`) | `info` | `info` |

## Azure Key Vault secret names

`infra/main.bicep` declares these slots. Set the value with
`az keyvault secret set --vault-name <kv> --name <secret> --value <…>`, then
point the `secrets[]` entry at `keyVaultUrl`.

| Key Vault secret | Env var | Get it from |
|---|---|---|
| `auth-secret` | `AUTH_SECRET` | `openssl rand -base64 48` |
| `database-url` | `DATABASE_URL` / `DIRECT_DATABASE_URL` | **derived by Bicep** — no action |
| `redis-url` | `REDIS_URL` | **derived by Bicep** — no action |
| `azure-storage-connection-string` | `AZURE_STORAGE_CONNECTION_STRING` | **derived by Bicep** — no action |
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | Stripe → Developers → API keys |
| `stripe-publishable-key` | `STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API keys |
| `stripe-webhook-secret` | `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → the **platform** endpoint |
| `stripe-connect-webhook-secret` | `STRIPE_CONNECT_WEBHOOK_SECRET` | Stripe → Webhooks → the **Connect** endpoint |
| `resend-api-key` | `RESEND_API_KEY` | resend.com → API Keys |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `whatsapp-phone-number-id` | `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup |
| `whatsapp-business-account-id` | `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta app → WhatsApp → API Setup |
| `whatsapp-access-token` | `WHATSAPP_ACCESS_TOKEN` | Meta → System User → permanent token |
| `whatsapp-webhook-verify-token` | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | you invent a random string |
| `whatsapp-app-secret` | `WHATSAPP_APP_SECRET` | Meta app → Settings → Basic |
| `sentry-dsn` | `SENTRY_DSN` | sentry.io → project (optional) |

Non-secret env values set directly on the Container App (in Bicep `appEnv` or via
`az containerapp update --set-env-vars`): `APP_URL`, `EMAIL_FROM`,
`PLATFORM_FEE_BPS`, `STRIPE_TAX_ENABLED`, `CHATBOT_MODEL`, `AZURE_STORAGE_CONTAINER`,
`STORAGE_PUBLIC_URL`, `APP_LOCALES`, `APP_DEFAULT_LOCALE`, `LOG_LEVEL`.

## Where they live

- **Local**: `.env` (git-ignored). Copy `.env.example`.
- **Tests**: `.env.test` (git-ignored) — `tests/setup.ts` loads it.
- **Azure**: Key Vault secrets, referenced by the Container Apps as `secretRef`
  (see `infra/main.bicep`). **Never in Git, never in the Docker image, never in
  logs** (the pino redaction list + the `logFinancialEvent` allowlist enforce
  this), never in this or any public doc.
