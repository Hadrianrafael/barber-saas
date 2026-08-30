# Azure Key Vault — secrets

Every runtime secret lives in Key Vault (`barber-<env>-kv-<hash>`), referenced by
the Container Apps as `secretRef`. **Never** in Git, in the Docker image, in
logs, or in a public doc.

`infra/main.bicep` declares **16 secret slots** with empty placeholder values.
The app (`src/env.ts`) treats an empty value as "not configured" and degrades
cleanly. Go-live = fill the values + point `secrets[]` at Key Vault.

## The 16 slots

| Key Vault secret | Env var | Source | Set by |
|---|---|---|---|
| `database-url` | `DATABASE_URL` / `DIRECT_DATABASE_URL` | **derived by Bicep** from the PG server | Bicep — no action |
| `redis-url` | `REDIS_URL` | **derived by Bicep** from Redis | Bicep — no action |
| `azure-storage-connection-string` | `AZURE_STORAGE_CONNECTION_STRING` | **derived by Bicep** from the Storage account | Bicep — no action |
| `auth-secret` | `AUTH_SECRET` | `openssl rand -base64 48` | you |
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | you |
| `stripe-publishable-key` | `STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API keys | you |
| `stripe-webhook-secret` | `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → platform endpoint | you |
| `stripe-connect-webhook-secret` | `STRIPE_CONNECT_WEBHOOK_SECRET` | Stripe → Webhooks → Connect endpoint | you |
| `resend-api-key` | `RESEND_API_KEY` | resend.com → API Keys | you |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | you |
| `whatsapp-phone-number-id` | `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup | you |
| `whatsapp-business-account-id` | `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta app → WhatsApp → API Setup | you |
| `whatsapp-access-token` | `WHATSAPP_ACCESS_TOKEN` | Meta → System Users → permanent token | you |
| `whatsapp-webhook-verify-token` | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | you invent a random string | you |
| `whatsapp-app-secret` | `WHATSAPP_APP_SECRET` | Meta app → Settings → Basic | you |
| `sentry-dsn` | `SENTRY_DSN` | sentry.io → project (optional) | you |

Non-secret env values are set directly on the app (`appEnv` in the Bicep, or
`az containerapp update --set-env-vars`): `APP_URL`, `EMAIL_FROM`,
`PLATFORM_FEE_BPS`, `STRIPE_TAX_ENABLED`, `CHATBOT_MODEL`,
`AZURE_STORAGE_CONTAINER`, `STORAGE_PUBLIC_URL`, `APP_LOCALES`,
`APP_DEFAULT_LOCALE`, `LOG_LEVEL`, `NODE_ENV`.

## 1. Grant the identities access

Each Container App and Job has a **system-assigned identity**. Give each one the
`Key Vault Secrets User` role on the vault:

```bash
KV_ID=$(az keyvault show -n barber-staging-kv-xxxx --query id -o tsv)
for app in web worker cron-reminders cron-retry-messages migrate; do
  PID=$(az containerapp $( [ $app = web ] || [ $app = worker ] && echo "" || echo "job" ) \
        show -g barber-staging -n barber-staging-$app --query identity.principalId -o tsv 2>/dev/null) || true
  [ -n "$PID" ] && az role assignment create --role "Key Vault Secrets User" \
    --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal --scope "$KV_ID"
done
```

(Or do it in the Portal: Key Vault → Access control (IAM) → Add role assignment →
Key Vault Secrets User → each app's managed identity.)

## 2. Put the values in

**Option A — the helper script** (recommended). Keep a **local, git-ignored**
`KEY=value` file (`.env.staging`, `.env.production` — both already in
`.gitignore`) and run:

```bash
az login
npm run keyvault:push -- --vault barber-staging-kv-xxxx --file .env.staging --dry-run   # preview (no values shown)
npm run keyvault:push -- --vault barber-staging-kv-xxxx --file .env.staging             # apply
```

The script maps env-var names → Key Vault secret names, skips empty vars, never
prints a value, and is idempotent (Key Vault versions each secret).

**Option B — by hand:**

```bash
az keyvault secret set --vault-name barber-staging-kv-xxxx --name auth-secret \
  --value "$(openssl rand -base64 48)" --output none
az keyvault secret set --vault-name barber-staging-kv-xxxx --name stripe-secret-key \
  --value "sk_test_..." --output none
# ...repeat for each slot you have a value for
```

## 3. Point the Container Apps at Key Vault

In `infra/main.bicep`, change each entry in `appSecrets` from
`{ name: 'stripe-secret-key', value: '' }` to:

```bicep
{
  name: 'stripe-secret-key'
  keyVaultUrl: '${kv.properties.vaultUri}secrets/stripe-secret-key'
  identity: 'system'
}
```

(leave `database-url` / `redis-url` / `azure-storage-connection-string` as the
derived `value:` — they are not in Key Vault). Then re-run
`az deployment group create …`. The apps roll a new revision that pulls the
secrets at startup.

## 4. Verify (without revealing values)

```bash
az keyvault secret list --vault-name barber-staging-kv-xxxx --query "[].name" -o tsv
# then, inside a running container:
az containerapp exec -g barber-staging -n barber-staging-web --command "npm run check:env"
```

`check:env` prints `configured` / `not configured` / masked hints only.

## Rotation

- **Stripe keys**: roll in the Stripe Dashboard → set the new value in Key Vault
  → redeploy (or `az containerapp secret set` + `az containerapp revision restart`).
- **WhatsApp access token**: regenerate the System User token → update
  `whatsapp-access-token` → redeploy.
- **`AUTH_SECRET`**: changing it invalidates all sessions (everyone re-logs in).
  Do it during a maintenance window; rotate no more than needed.
- Key Vault keeps every version — you can roll back a secret without a code
  change.

## What must NEVER happen

- A secret committed to Git — `.gitignore` blocks `.env`, `.env.*`, `*.pem`,
  `*.key`, `secrets/`; the pre-commit lint-staged hook + a manual
  `git grep -nE "sk_(test|live)_|whsec_|re_[0-9A-Za-z]{16}"` before a release.
- A secret in the Docker image — `.dockerignore` excludes `.env*`, `.git`.
- A secret in a log — pino redaction list + `logFinancialEvent` allowlist; the
  scripts here print masked hints only.
