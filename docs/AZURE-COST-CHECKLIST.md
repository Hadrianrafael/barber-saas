# Azure cost checklist

Which resources in `infra/main.bicep` are billed, and which can grow with usage.
**No prices are quoted here** — Azure pricing changes and varies by region.
Check the official pages (linked) and the **Azure Pricing Calculator**
(<https://azure.microsoft.com/pricing/calculator/>) for your region
(`brazilsouth` in the examples).

Live spend: Portal → **Cost Management + Billing** → Cost analysis, filtered by
resource group (`barber-staging`, `barber-prod`).

## Billed resources (per environment)

| Resource | Bicep sizing | Cost model | Notes / official price page |
|---|---|---|---|
| **Container Apps — web** | 0.5 vCPU / 1 GiB · prod min 1 / max 8 replicas · non-prod min 0 / max 3 | per vCPU-second + per GiB-second of **active** replicas + requests; idle (scaled to 0) is free | <https://azure.microsoft.com/pricing/details/container-apps/> |
| **Container Apps — worker** | 0.5 vCPU / 1 GiB · **min 1** (always on) | same; the `min 1` means it never scales to 0 → a constant baseline | same |
| **Container Apps Jobs** (`cron-reminders` `*/15`, `cron-retry` `*/5`, `migrate` manual) | 0.25 vCPU / 0.5 GiB, seconds per run | per vCPU/GiB-second **only while a run executes** (a few seconds each) → negligible | same |
| **PostgreSQL Flexible Server** | prod `Standard_D2ds_v5` GeneralPurpose + **ZoneRedundant HA** + 64 GB + 21-day geo backup · non-prod `Standard_B1ms` Burstable + 32 GB | compute (per hour, **HA doubles it**) + storage (per GB/month) + backup storage beyond the free amount (= provisioned storage) + geo-backup egress | <https://azure.microsoft.com/pricing/details/postgresql/flexible-server/> — **biggest fixed line item in prod** |
| **Azure Cache for Redis** | prod `Standard C1` · non-prod `Basic C0` | per hour by tier/size; Standard = replicated (≈2× Basic) | <https://azure.microsoft.com/pricing/details/cache/> |
| **Storage account (Blob)** | prod `Standard_ZRS` · non-prod `Standard_LRS` · `uploads` container, public blob | per GB/month stored + per-10k operations + egress | <https://azure.microsoft.com/pricing/details/storage/blobs/> — small unless you store many large images |
| **Container Registry (ACR)** | `Basic` | flat per day + storage beyond the included amount + egress on pulls | <https://azure.microsoft.com/pricing/details/container-registry/> |
| **Log Analytics workspace** | `PerGB2018` · retention prod 90d / non-prod 30d | **per GB ingested** + per GB/month retained beyond the free 31 days | <https://azure.microsoft.com/pricing/details/monitor/> — can surprise if the app logs verbosely; `LOG_LEVEL=info` keeps it modest |
| **Key Vault** | `standard` | per 10k operations (secret reads at container start) + a small per-secret cost for versions | <https://azure.microsoft.com/pricing/details/key-vault/> — effectively negligible |
| **Container Apps Environment** | 1 per env | no charge for the environment itself; you pay for the apps in it | — |
| **Managed TLS certificate** (custom domain) | 1 per hostname | **free** (Azure-managed) | — |
| **Public egress / bandwidth** | — | outbound data transfer (Stripe/Anthropic/Meta calls, blob downloads, page loads) | <https://azure.microsoft.com/pricing/details/bandwidth/> |

## Fixed baseline vs variable

**Roughly fixed each month (prod):** PostgreSQL compute (×2 for HA) + storage +
Redis Standard + ACR Basic + the always-on worker replica + a minimum web
replica.

**Variable / usage-driven:**

- web replicas scaling under traffic,
- Log Analytics ingestion (proportional to request volume + log verbosity),
- Blob storage growth + egress (image uploads, public page image loads),
- PostgreSQL storage auto-grow + backup storage as data grows,
- egress bandwidth.

**Not billed by Azure** (billed by the third party): Stripe fees, Resend plan,
Meta/WhatsApp conversation pricing, Anthropic token usage. Track those in their
own dashboards.

## Cost controls to set up (N5 in the checklist)

- [ ] Portal → Cost Management → **Budgets**: a monthly budget per resource group
      with alerts at 50 / 80 / 100 %.
- [ ] Non-prod: web `minReplicas: 0` (already in the Bicep) so staging costs
      ~nothing when idle; consider **stopping** the staging worker/PG when not
      testing (`az containerapp update --min-replicas 0 --max-replicas 0`,
      `az postgres flexible-server stop`).
- [ ] PostgreSQL: start prod **without** ZoneRedundant HA if the budget is tight
      at launch (`highAvailability.mode: 'Disabled'`) — you still have PITR + geo
      backup; add HA later. This roughly halves the PG compute line.
- [ ] Log Analytics: keep `LOG_LEVEL=info` (default); consider a **daily cap**
      on the workspace and shorter retention for non-prod.
- [ ] Redis: `Basic C0` is enough for a small launch; move to `Standard` when you
      need the SLA / failover.
- [ ] ACR: enable a **retention policy** / purge old tags (untagged manifests)
      periodically.
- [ ] Delete the staging resource group entirely between test campaigns and
      re-deploy from Bicep when needed (infra is reproducible).

## Where to see the real numbers

1. **Before provisioning** — Azure Pricing Calculator with the exact SKUs above.
2. **After provisioning** — Portal → Cost Management → Cost analysis → scope =
   the resource group → group by "Resource" or "Meter".
3. **Per third party** — Stripe Dashboard (fees), Resend billing, Meta WhatsApp
   Manager (conversation pricing), Anthropic Console (usage).
