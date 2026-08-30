# Azure deployment

Target: **Azure Container Apps** (web + worker + scheduled jobs), **Azure
Database for PostgreSQL Flexible Server**, **Azure Cache for Redis**, **Azure
Blob Storage**, **Azure Key Vault**, **Azure Container Registry**.

Environments: `dev`, `staging`, `prod` — one resource group each, same Bicep
template (`infra/main.bicep`) parameterised by `environment`.

## 1. Provision (per environment)

```bash
az group create -n barber-prod -l brazilsouth

az deployment group create \
  -g barber-prod \
  -f infra/main.bicep \
  -p namePrefix=barber environment=prod \
     pgAdminLogin=barberadmin \
     pgAdminPassword='<generate>' \
     appUrl=https://app.example.com \
     webImage=barberacr.azurecr.io/barber-saas:bootstrap \
     workerImage=barberacr.azurecr.io/barber-saas:bootstrap
```

The template creates: Log Analytics, ACR, Postgres Flexible Server, Redis, a
Storage account + blob container, Key Vault (+ the Container Apps' managed
identity with `get`/`list` on secrets), the Container Apps environment, the
**web** app, the **worker** app, and a **`reminders`** scheduled job.

## 2. Secrets → Key Vault

Put every value from `docs/deployment/environment-variables.md` in Key Vault
(`az keyvault secret set …`). The Container Apps reference them as `secretRef`.
Nothing sensitive goes in the Bicep parameters file or the image.

Add the two extra scheduled jobs the template does not yet create (or add them
to the Bicep):

```bash
for job in reminders retry-messages; do
  az containerapp job create \
    -g barber-prod -n barber-prod-cron-$job \
    --environment barber-prod-cae \
    --trigger-type Schedule \
    --cron-expression "$( [ $job = reminders ] && echo '*/15 * * * *' || echo '*/5 * * * *' )" \
    --image barberacr.azurecr.io/barber-saas:latest \
    --command "npm" --args "run,cron:$job" \
    --secret-volume-mount /secrets  # or wire secretRefs like the apps
done
```

Commands: `npm run start` (web), `npm run worker:start` (worker),
`npm run cron:reminders` / `npm run cron:retry-messages` (jobs).

## 3. CI/CD

`.github/workflows/deploy.yml`:

- **staging** deploys automatically on green `main` (after `ci.yml` passes).
- **production** is `workflow_dispatch` only, gated by the `production` GitHub
  Environment (required reviewers).
- Flow: `az acr build` → `prisma migrate deploy` (forward-only, runs once before
  any app rolls) → `az containerapp update --image` for web, worker and jobs →
  readiness smoke check against `/api/health`.
- No `az … delete`. Rollback = re-run with an older commit SHA / pin the image
  tag.

Required GitHub secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID` (OIDC federated credential), `AZURE_RESOURCE_GROUP`,
`ACR_NAME`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `APP_HEALTH_URL`.

## 4. Probes

- **Liveness** → `GET /api/health/live` (no dependencies).
- **Readiness** → `GET /api/health` (checks Postgres; Redis degrades but stays
  ready).

## 5. Webhook URLs

| Provider | staging | production |
|---|---|---|
| Stripe (SaaS billing) | `https://staging.<domain>/api/webhooks/stripe` | `https://<domain>/api/webhooks/stripe` |
| Stripe **Connect** | `https://staging.<domain>/api/webhooks/stripe/connect` | `https://<domain>/api/webhooks/stripe/connect` |
| WhatsApp | `https://staging.<domain>/api/webhooks/whatsapp` | `https://<domain>/api/webhooks/whatsapp` |

Each Stripe endpoint has its **own signing secret** — put the SaaS one in
`STRIPE_WEBHOOK_SECRET` and the Connect one (created with "Listen to events on
Connected accounts" checked) in `STRIPE_CONNECT_WEBHOOK_SECRET`. Full event list
and setup: [../STRIPE.md](../STRIPE.md).

## 6. First deploy checklist

- [ ] Bicep deployed, Key Vault populated
- [ ] `prisma migrate deploy` succeeded against the prod DB
- [ ] `npm run db:seed` once (creates the 3 plans + the super-admin from
      `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
- [ ] `STRIPE_SECRET_KEY=… npm run stripe:sync-plans` (test) — or `-- --allow-live`
      for prod — to create the Stripe Products/Prices and backfill the `Plan` rows
- [ ] Stripe + Stripe Connect + WhatsApp webhooks created at the URLs above,
      signing secrets in Key Vault
- [ ] DNS + TLS on the Container Apps custom domain; HSTS confirmed
- [ ] `/api/health` returns `{"status":"healthy"}`
