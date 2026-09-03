# Azure infrastructure

`main.bicep` provisions one environment. Deploy it once per environment
(`dev` / `staging` / `prod`), each into its own resource group. See
[`../docs/deployment/azure.md`](../docs/deployment/azure.md) and
[`../docs/GO-LIVE.md`](../docs/GO-LIVE.md) for the full runbook.

## What it provisions

| Resource | Name pattern | Purpose |
|---|---|---|
| Log Analytics | `barber-<env>-logs` | Container Apps logs/metrics |
| Container Registry | `barberacr<hash>` | one image: `barber-saas:<tag>` |
| PostgreSQL Flexible Server 16 | `barber-<env>-pg-<hash>` | database `barber` |
| Azure Cache for Redis | `barber-<env>-redis-<hash>` | session cache, rate limiting, BullMQ |
| Storage + `uploads` container | `barber<slug>st<hash>` (`slug` = dev/stg/prd) | Blob object storage |
| Key Vault | `barber-<slug>-kv-<hash>` (`slug` = dev/stg/prd) | secret values |
| Container Apps env | `barber-<env>-cae` | runtime |
| Container App `-web` | `barber-<env>-web` | Next.js standalone, external ingress; probes `/api/health/live` (liveness/startup) + `/api/health` (readiness) |
| Container App `-worker` | `barber-<env>-worker` | BullMQ worker (`npx tsx src/worker/index.ts`) |
| Job `-cron-reminders` | `barber-<env>-cron-reminders` | schedule `*/15 * * * *` |
| Job `-cron-retry` | `barber-<env>-cron-retry` | schedule `*/5 * * * *` (message retry) |
| Job `-migrate` | `barber-<env>-migrate` | manual — `npx prisma migrate deploy` (run before routing traffic) |

**One image, three roles.** The web app uses the image default CMD
(`node server.js`); the worker and jobs override `command`. The image is
`barber-saas:<tag>` (built with `az acr build --file Dockerfile .`, no
`--target`).

## Deploy (per environment)

The ACR name is `uniqueString`-derived, so it isn't known before the first
deploy. Use the helper, which deploys the template twice (bootstrap public image
→ `az acr build` → real image):

```bash
az login && az account set --subscription "<sub>"
export RG=barber-staging LOCATION=brazilsouth APP_URL=https://staging.<domain>
export PG_ADMIN_LOGIN=barberadmin PG_ADMIN_PASSWORD='<openssl rand -base64 24>'
npm run provision:staging      # = bash scripts/azure/provision-staging.sh

# first run only — create the plans + super admin
az containerapp job start -g barber-staging -n barber-staging-migrate
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed   # against the staging DB
```

See [`../docs/deployment/azure.md`](../docs/deployment/azure.md) §1 for the
manual two-pass equivalent.

After the first deploy, `.github/workflows/deploy.yml` does build → migrate job →
roll web/worker/jobs → readiness smoke check on every push (staging) or manual
dispatch (production).

## Secrets

`main.bicep` declares **every secret slot** with an empty placeholder value.
`src/env.ts` treats an empty value as "not configured" and the feature degrades
cleanly — nothing is simulated. To go live:

1. Grant each Container App / Job system-assigned identity the
   **Key Vault Secrets User** role on the vault.
2. Put the real values in Key Vault (names match the `secrets[]` entries:
   `auth-secret`, `stripe-secret-key`, `stripe-webhook-secret`,
   `stripe-connect-webhook-secret`, `resend-api-key`, `anthropic-api-key`,
   `whatsapp-*`, `sentry-dsn`, …). The full list + where to obtain each is in
   [`../docs/deployment/environment-variables.md`](../docs/deployment/environment-variables.md).
3. Change each `secrets[]` entry from `value: ''` to
   `keyVaultUrl: '<vault-uri>/secrets/<name>'` + `identity: 'system'` and
   redeploy.

`database-url`, `redis-url` and `azure-storage-connection-string` are derived
from the provisioned resources and are real from the first deploy.

> Some Container Apps API versions reject a secret with an empty `value`. If the
> deployment complains, give the unused slots a single space `' '` (still read as
> "not configured" by `env.ts`) until you wire Key Vault.

## Hardening TODO before prod

- Put Postgres + Redis on a VNet; delete the `0.0.0.0` firewall rule.
- Private endpoints for Storage and Key Vault.
- Azure Front Door / WAF in front of the web ingress; bind the custom domain +
  managed certificate there.
- Consider a dedicated ACR per subscription (Standard/Premium) with retention.
