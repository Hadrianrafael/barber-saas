# Azure Key Vault — secrets

Every external-integration secret lives in Key Vault (`barber-<slug>-kv-<hash>`,
where `slug` is `dev` / `stg` / `prd` — Key Vault names are capped at 24 chars)
and is read by web/worker/jobs at container-start as a `keyVaultUrl` reference
— **never** inline in the Bicep, in Git, in the Docker image, or in logs. The
exact vault name is the `keyVaultName` output of the deployment — read it,
don't guess.

`infra/main.bicep` declares **21 secret slots**: 5 stay **inline**, derived
straight from resources the same template provisions (nothing to put in the
vault for these); the other 16 are **Key Vault references** — `env.ts` treats
an unset/placeholder value as "not configured" and every feature degrades
cleanly until a real value is set.

## The 5 inline slots (not in Key Vault — nothing to do)

| Key Vault-style name | Env var | Source |
|---|---|---|
| `database-url` / `direct-database-url` | `DATABASE_URL` / `DIRECT_DATABASE_URL` | derived by Bicep from the PG server |
| `redis-url` | `REDIS_URL` | derived by Bicep from the Redis Container App |
| `azure-storage-connection-string` | `AZURE_STORAGE_CONNECTION_STRING` | derived by Bicep from the Storage account |
| `auth-secret` | `AUTH_SECRET` | the `authSecret` deploy parameter — generate once (`openssl rand -base64 48`), then pass the **same** value on every redeploy; changing it invalidates every session |

## The 16 Key Vault-referenced slots

| Key Vault secret | Env var | Source |
|---|---|---|
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | Stripe → Developers → API keys |
| `stripe-publishable-key` | `STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API keys |
| `stripe-webhook-secret` | `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → platform endpoint |
| `stripe-connect-webhook-secret` | `STRIPE_CONNECT_WEBHOOK_SECRET` | Stripe → Webhooks → Connect endpoint |
| `resend-api-key` | `RESEND_API_KEY` | resend.com → API Keys |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `whatsapp-phone-number-id` | `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup |
| `whatsapp-business-account-id` | `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta app → WhatsApp → API Setup |
| `whatsapp-access-token` | `WHATSAPP_ACCESS_TOKEN` | Meta → System Users → permanent token |
| `whatsapp-webhook-verify-token` | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | you invent a random string |
| `whatsapp-app-secret` | `WHATSAPP_APP_SECRET` | Meta app → Settings → Basic |
| `sentry-dsn` | `SENTRY_DSN` | sentry.io → project (optional) |
| `openai-api-key` | `OPENAI_API_KEY` | platform.openai.com → API keys (SDR — optional) |
| `external-voice-base-url` | `EXTERNAL_VOICE_BASE_URL` | cloned-voice TTS provider (SDR — optional) |
| `external-voice-api-key` | `EXTERNAL_VOICE_API_KEY` | cloned-voice TTS provider (SDR — optional) |
| `external-voice-id` | `EXTERNAL_VOICE_ID` | cloned-voice TTS provider — the voice id (SDR — optional) |

Non-secret env values are set directly on the app (`appEnv` in the Bicep, or
`az containerapp update --set-env-vars`): `APP_URL`, `EMAIL_FROM`,
`PLATFORM_FEE_BPS`, `STRIPE_TAX_ENABLED`, `CHATBOT_MODEL`, `SDR_TEST_MODE`,
`OPENAI_MODEL`, `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`,
`OPENAI_TTS_VOICE`, `VOICE_PROVIDER`, `AZURE_STORAGE_CONTAINER`,
`STORAGE_PUBLIC_URL`, `APP_LOCALES`, `APP_DEFAULT_LOCALE`, `LOG_LEVEL`,
`NODE_ENV`.

## How the wiring works (already in place — nothing to redeploy for this)

The Bicep provisions one user-assigned identity (`<envPrefix>-id`, already used
for ACR pull) and grants it the built-in **Key Vault Secrets User** role on the
vault (`kvSecretsAccess` in `infra/main.bicep`) — read-only data-plane access,
no write, no admin. Each of the 16 slots above becomes a Container App secret
of the form:

```bicep
{
  name: 'openai-api-key'
  keyVaultUrl: 'https://<vault-name>.vault.azure.net/secrets/openai-api-key'
  identity: '<uami-resource-id>'
}
```

Bicep only **reads** these — it never creates or sets their value, so
redeploying the app (a new image, a new feature) can never overwrite a real
credential already in the vault. That also means: **a slot must exist in the
vault before the first deployment that references it.** All 16 already do (as
the same single-space "not configured" placeholder used for the inline slots)
— this repo's operator created them once; you only need to overwrite the
*value*, never create the slot.

## 1. Give yourself write access (one-time, per person)

The vault is **RBAC-mode**: being subscription/RG **Owner does not grant Key
Vault data-plane access** (list/get/set a secret) — that needs an explicit
role on the vault itself.

```bash
KV_ID=$(az keyvault show -n barber-stg-kv-xxxx --query id -o tsv)
az role assignment create --role "Key Vault Secrets Officer" \
  --assignee-object-id "$(az ad signed-in-user show --query id -o tsv)" \
  --assignee-principal-type User --scope "$KV_ID"
```

(Or in the Portal: Key Vault → Access control (IAM) → Add role assignment →
Key Vault Secrets Officer → yourself.) Do this once; skip if you already have
it.

## 2. Put the values in

**Option A — the helper script** (recommended). Keep a **local, git-ignored**
`KEY=value` file (`.env.staging`, `.env.production` — both already in
`.gitignore`) and run:

```bash
az login
npm run keyvault:push -- --vault barber-stg-kv-xxxx --file .env.staging --dry-run   # preview (no values shown)
npm run keyvault:push -- --vault barber-stg-kv-xxxx --file .env.staging             # apply
```

The script maps env-var names → Key Vault secret names (see `MAP` in
`scripts/keyvault-push.ts`), skips empty vars, never prints a value, and is
idempotent (Key Vault versions each secret).

**Option B — by hand, one at a time:**

```bash
az keyvault secret set --vault-name barber-stg-kv-xxxx --name openai-api-key \
  --value "sk-..." --output none
az keyvault secret set --vault-name barber-stg-kv-xxxx --name stripe-secret-key \
  --value "sk_test_..." --output none
# ...repeat for each slot you have a value for
```

## 3. Make it take effect

Container Apps polls Key Vault-referenced secrets roughly every 30 minutes on
its own. To apply a new value immediately, restart the revision:

```bash
az containerapp revision restart -g barber-staging -n barber-staging-web \
  --revision "$(az containerapp show -g barber-staging -n barber-staging-web --query properties.latestRevisionName -o tsv)"
az containerapp revision restart -g barber-staging -n barber-staging-worker \
  --revision "$(az containerapp show -g barber-staging -n barber-staging-worker --query properties.latestRevisionName -o tsv)"
```

No image rebuild, no `az deployment group create`, no code change needed —
only the two commands above (or a 30-minute wait).

## 4. Verify (without revealing values)

```bash
az keyvault secret list --vault-name barber-stg-kv-xxxx --query "[].name" -o tsv
# then, inside a running container:
az containerapp exec -g barber-staging -n barber-staging-web --command "npm run check:env"
```

`check:env` prints `configured` / `not configured` / masked hints only.

## Rotation

- **Stripe keys**: roll in the Stripe Dashboard → set the new value in Key
  Vault (step 2) → restart the revision (step 3).
- **WhatsApp access token**: regenerate the System User token → update
  `whatsapp-access-token` → restart the revision.
- **`AUTH_SECRET`**: not in Key Vault (see above) — changing it invalidates
  every session. Do it during a maintenance window, via a redeploy with a new
  `authSecret` param value, no more often than needed.
- Key Vault keeps every version — you can roll back a secret without a code
  change (`az keyvault secret set` with the previous value, or
  `az keyvault secret list-versions` + `az keyvault secret show --version`).

## What must NEVER happen

- A secret committed to Git — `.gitignore` blocks `.env`, `.env.*`, `*.pem`,
  `*.key`, `secrets/`; verify before a release with
  `git grep -nE "sk_(test|live)_|whsec_|re_[0-9A-Za-z]{16}|sk-ant-"`.
- A secret in the Docker image — `.dockerignore` excludes `.env*`, `.git`; the
  Dockerfile's build-time `ENV` values are hardcoded, format-valid dummies
  (`build:build@localhost`, `build-only-placeholder-not-used-at-runtime`) that
  never reach the runtime image (the `runner` stage starts `FROM base`, fresh).
- A secret in a log — pino redaction list + `logFinancialEvent` allowlist; the
  scripts here print masked hints only.
