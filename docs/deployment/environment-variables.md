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

## Where they live

- **Local**: `.env` (git-ignored). Copy `.env.example`.
- **Tests**: `.env.test` (git-ignored) — `tests/setup.ts` loads it.
- **Azure**: Key Vault secrets, referenced by the Container Apps as `secretRef`
  (see `infra/main.bicep`). Never in Git, never in the image.
