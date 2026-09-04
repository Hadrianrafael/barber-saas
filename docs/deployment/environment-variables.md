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

`infra/main.bicep` declares these slots. The Stripe/Resend/Anthropic/WhatsApp/
Sentry/OpenAI/voice ones are **already** Key Vault references (`keyVaultUrl` +
the app's identity) — set the value with
`az keyvault secret set --vault-name <kv> --name <secret> --value <…>` and
restart the revision; no Bicep change or redeploy needed. Full walkthrough
(including the one-time RBAC grant the vault requires) in
[`keyvault.md`](./keyvault.md).

| Key Vault secret | Env var | Get it from |
|---|---|---|
| `auth-secret` *(inline, not in Key Vault)* | `AUTH_SECRET` | `openssl rand -base64 48` — pass the same value on every redeploy |
| `database-url` *(inline)* | `DATABASE_URL` / `DIRECT_DATABASE_URL` | **derived by Bicep** — no action |
| `redis-url` *(inline)* | `REDIS_URL` | **derived by Bicep** — no action |
| `azure-storage-connection-string` *(inline)* | `AZURE_STORAGE_CONNECTION_STRING` | **derived by Bicep** — no action |
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
| `openai-api-key` | `OPENAI_API_KEY` | platform.openai.com → API keys (SDR brain / transcription / TTS — optional) |
| `external-voice-base-url` | `EXTERNAL_VOICE_BASE_URL` | your cloned-voice TTS provider (optional; falls back to OpenAI TTS) |
| `external-voice-api-key` | `EXTERNAL_VOICE_API_KEY` | same provider (optional) |
| `external-voice-id` | `EXTERNAL_VOICE_ID` | same provider — the voice id to use (optional) |

### SDR / AI Sales Assistant

The whole module degrades cleanly: with `OPENAI_API_KEY` unset it uses a
deterministic fallback reply, no transcription and no TTS; with the external
voice unset it uses OpenAI TTS. **`SDR_TEST_MODE=true` (a non-secret env var, set
in `infra/main.bicep`) is a hard kill-switch** — while it is on, no message is
sent to a real lead, only to entries on the in-app test allowlist. Production
sending also requires a per-lead lawful basis recorded in the admin UI and an
explicit toggle at `/admin/sales/settings`.

Non-secret env values set directly on the Container App (in Bicep `appEnv` or via
`az containerapp update --set-env-vars`): `APP_URL`, `EMAIL_FROM`,
`PLATFORM_FEE_BPS`, `STRIPE_TAX_ENABLED`, `CHATBOT_MODEL`, `AZURE_STORAGE_CONTAINER`,
`STORAGE_PUBLIC_URL`, `APP_LOCALES`, `APP_DEFAULT_LOCALE`, `LOG_LEVEL`.

## Where they live

- **Local**: `.env` (git-ignored). Copy `.env.example`.
- **Tests**: `.env.test` (git-ignored) — `tests/setup.ts` loads it.
- **Azure**: the 16 external-integration secrets live in Key Vault, referenced
  by the Container Apps as `keyVaultUrl`; the 5 resource-derived/internal ones
  are inline, set by the Bicep deploy itself (see `infra/main.bicep` and
  [`keyvault.md`](./keyvault.md)). **Never in Git, never in the Docker image,
  never in logs** (the pino redaction list + the `logFinancialEvent` allowlist
  enforce this), never in this or any public doc.
