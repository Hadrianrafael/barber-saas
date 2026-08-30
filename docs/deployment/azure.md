# Azure deployment

> This is the reference for the infrastructure. The **step-by-step launch
> runbook** is [`../GO-LIVE.md`](../GO-LIVE.md).

Target: **Azure Container Apps** (web + worker + scheduled jobs), **Azure
Database for PostgreSQL Flexible Server 16**, **Azure Cache for Redis**, **Azure
Blob Storage**, **Azure Key Vault**, **Azure Container Registry**.

Environments: `dev` / `staging` / `prod` — one resource group each, the same
Bicep template (`infra/main.bicep`) parameterised by `environment`. All resource
names are `barber-<env>-<role>` (e.g. `barber-staging-web`, `barber-prod-worker`).

## 1. Provision (per environment)

```bash
az group create -n barber-staging -l brazilsouth

# one image runs every role (web default CMD; worker + jobs override command)
az acr build -r <acr-name> -t barber-saas:$(git rev-parse --short HEAD) --file Dockerfile .

az deployment group create \
  -g barber-staging \
  -f infra/main.bicep \
  -p namePrefix=barber environment=staging \
     image=<acr>.azurecr.io/barber-saas:<tag> \
     pgAdminLogin=barberadmin \
     pgAdminPassword='<generate>' \
     appUrl=https://staging.<your-domain>
```

Creates: Log Analytics, ACR, Postgres Flexible Server, Redis, a Storage account
+ `uploads` container, Key Vault, the Container Apps environment, and:

| Resource | Role |
|---|---|
| `barber-<env>-web` | Next.js standalone, external ingress, default CMD `node server.js` |
| `barber-<env>-worker` | BullMQ consumer — `command: npx tsx src/worker/index.ts` |
| `barber-<env>-cron-reminders` | schedule `*/15 * * * *` |
| `barber-<env>-cron-retry-messages` | schedule `*/5 * * * *` |
| `barber-<env>-migrate` | **manual** trigger — `npx prisma migrate deploy` (runs inside the CAE, so it can reach a VNet DB) |

`DATABASE_URL`, `REDIS_URL` and `AZURE_STORAGE_CONNECTION_STRING` are derived
from the provisioned resources — real from the first deploy.

## 2. Secrets → Key Vault

The Bicep declares **every integration secret slot** with an empty placeholder.
`src/env.ts` reads an empty value as "not configured" and the feature degrades
cleanly — nothing is simulated. To activate:

1. Grant each Container App / Job **system-assigned identity** the
   `Key Vault Secrets User` role on `barber-<env>-kv-…`.
2. `az keyvault secret set` every value (names match the `secrets[]` entries;
   where to obtain each is in
   [`environment-variables.md`](environment-variables.md) and
   [`../GO-LIVE.md`](../GO-LIVE.md) §8).
3. In `infra/main.bicep`, change each `secrets[]` entry from `value: ''` to
   `keyVaultUrl: '<vault-uri>/secrets/<name>'` + `identity: 'system'`, then
   redeploy.

> If a Container Apps API version rejects an empty secret `value`, use a single
> space `' '` for the unused slots until Key Vault is wired.

## 3. Migrations + seed (first deploy)

```bash
az containerapp job start -g barber-staging -n barber-staging-migrate
# once, against the staging DB:
SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='<strong>' npm run db:seed
```

`deploy.yml` runs the `-migrate` job on every deploy thereafter (waits for
`Succeeded`, fails the deploy on `Failed`). Forward-only — no destructive
migration is ever auto-run.

## 4. CI/CD — `.github/workflows/deploy.yml`

- **staging** deploys automatically on green `main` (after `ci.yml`).
- **production** is `workflow_dispatch`, gated by the `production` GitHub
  Environment (required reviewers).
- Flow: `az acr build` (one image) → start the `-migrate` job + wait → roll
  `-web`, `-worker`, `-cron-reminders`, `-cron-retry-messages` with the new
  image → readiness smoke check.
- No `az … delete`. Rollback = re-run with an older SHA, or
  `az containerapp revision set-active`.
- The workflow maps the GitHub Environment name (`staging` | `production`) to the
  Bicep short name (`staging` | `prod`).

Required GitHub secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID` (OIDC federated credential), `AZURE_RESOURCE_GROUP`,
`ACR_NAME`, `APP_HEALTH_URL`.

## 5. Probes

| Probe | Path | Notes |
|---|---|---|
| Liveness | `GET /api/health/live` | no dependencies — a failing DB does not restart the container |
| Readiness | `GET /api/health` | checks Postgres (503 on failure); Redis degrades but stays ready |
| Startup | `GET /api/health/live` | up to 60 s to boot |

## 6. Webhook URLs

| Provider | staging | production |
|---|---|---|
| Stripe (SaaS billing) | `https://staging.<domain>/api/webhooks/stripe` | `https://<domain>/api/webhooks/stripe` |
| Stripe **Connect** | `https://staging.<domain>/api/webhooks/stripe/connect` | `https://<domain>/api/webhooks/stripe/connect` |
| WhatsApp | `https://staging.<domain>/api/webhooks/whatsapp` | `https://<domain>/api/webhooks/whatsapp` |

Each Stripe endpoint has its **own signing secret**: SaaS →
`STRIPE_WEBHOOK_SECRET`, Connect (created with "Listen to events on Connected
accounts") → `STRIPE_CONNECT_WEBHOOK_SECRET`. Event lists: [`../STRIPE.md`](../STRIPE.md).

## 7. Custom domain

Container Apps → `barber-<env>-web` → Custom domains → add the hostname, pass DNS
validation, bind a **managed certificate**. Then set `appUrl` in the Bicep
params to the final `https://…` and redeploy so `APP_URL` is correct everywhere
(e-mail links, booking links, Stripe return URLs). HSTS is emitted automatically
in production; the CSP already allows Stripe / Anthropic / Meta. The app is
same-origin — no CORS configuration.

## 8. Hardening TODO before prod (tracked)

- Postgres + Redis on a VNet; remove the `0.0.0.0` firewall rule.
- Private endpoints for Storage + Key Vault.
- Azure Front Door / WAF in front of the web ingress.

## 9. First-deploy checklist

- [ ] Bicep deployed for the environment; Key Vault populated + identities have `Secrets User`
- [ ] `secrets[]` switched to `keyVaultUrl` references; redeployed
- [ ] `barber-<env>-migrate` job ran; `prisma migrate status` clean
- [ ] `npm run db:seed` once (3 plans + super admin from `SEED_ADMIN_*`)
- [ ] `STRIPE_SECRET_KEY=… npm run stripe:sync-plans` (`-- --allow-live` only for a live key)
- [ ] Stripe + Stripe Connect + WhatsApp webhooks created at the real URLs, secrets in Key Vault
- [ ] Custom domain bound, HTTPS managed cert, `APP_URL` updated
- [ ] `GET /api/health` → `{"status":"healthy"}`; `GET /api/health/live` → `{"status":"alive"}`
