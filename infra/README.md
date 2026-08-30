# Azure infrastructure

`main.bicep` is a **starting point** — review networking, SKUs and the
secret-management wiring before a real deployment.

## What it provisions

| Resource | Purpose |
|---|---|
| Log Analytics | Container Apps logs/metrics |
| Container Registry (ACR) | web + worker images |
| PostgreSQL Flexible Server 16 | primary database (`barber` db) |
| Azure Cache for Redis | session cache, rate limiting, BullMQ |
| Storage Account + `uploads` container | object storage (Blob driver) |
| Key Vault | secret values (populate out of band) |
| Container Apps Environment | runtime |
| Container App `-web` | Next.js standalone, external ingress, `/api/health` probe |
| Container App `-worker` | BullMQ worker |
| Container Apps Job `-reminders` | cron `*/5 * * * *` |

## Deploy

```bash
az group create -n barber-saas-prod -l brazilsouth

# Build & push images
az acr build -r <acr> -t barber-web:$(git rev-parse --short HEAD) --target web .
az acr build -r <acr> -t barber-worker:$(git rev-parse --short HEAD) --target worker .

az deployment group create \
  -g barber-saas-prod \
  -f infra/main.bicep \
  -p infra/main.parameters.json \
  -p pgAdminPassword='<from-keyvault-or-prompt>' \
     webImage='<acr>.azurecr.io/barber-web:<tag>' \
     workerImage='<acr>.azurecr.io/barber-worker:<tag>'
```

## Secrets

The template creates Key Vault and gives each Container App a system-assigned
identity. Before go-live:

1. Put real values in Key Vault: `auth-secret`, `stripe-secret-key`,
   `stripe-webhook-secret`, `stripe-connect-webhook-secret`, `resend-api-key`,
   `anthropic-api-key`, WhatsApp tokens, `azure-storage-connection-string`.
2. Grant each Container App identity `Key Vault Secrets User` on the vault.
3. Change the app `secrets` entries from inline `value` to
   `keyVaultUrl` + `identity` references, and redeploy.

## Migrations

Run `npm run db:deploy` (prisma migrate deploy) as a one-off Container Apps Job
or from CI against `DATABASE_URL` before routing traffic to a new revision.

## Hardening TODO before prod

- Put Postgres + Redis on a VNet; remove the `0.0.0.0` firewall rule.
- Private endpoints for Storage and Key Vault.
- WAF / Front Door in front of the web ingress.
- Separate `staging` resource group from the same template.
