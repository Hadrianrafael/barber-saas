# Backup, restore & recovery

What Azure actually provides for this stack, and the exact steps to recover.

## PostgreSQL (Azure Database for PostgreSQL Flexible Server)

The Bicep configures **automated backups**:

| | dev/staging | prod |
|---|---|---|
| retention | 7 days | 21 days |
| geo-redundant | disabled | **enabled** |
| point-in-time restore (PITR) | yes, within retention | yes, within retention |

Backups are automatic and free within retention; you don't schedule anything.

### Restore (PITR → a NEW server)

Flexible Server restores to a **new** server (the original is untouched — not
destructive).

```bash
# to a specific instant (within retention)
az postgres flexible-server restore \
  -g barber-prod \
  --name barber-prod-pg-restored \
  --source-server barber-prod-pg-<hash> \
  --restore-time "2026-09-10T14:30:00Z"

# or geo-restore to another region (prod only)
az postgres flexible-server geo-restore \
  -g barber-prod-dr --name barber-prod-pg-dr \
  --source-server barber-prod-pg-<hash> --location eastus
```

Then:

1. Point the app at the restored server: update the `database-url` secret
   (`az keyvault secret set … --name database-url --value 'postgresql://…restored…'`)
   or, if you kept `database-url` as a derived Bicep value, redeploy the Bicep
   with the new server name.
2. `az containerapp revision restart` the web + worker so they reconnect.
3. `npm run preflight` → `✓ PostgreSQL`.

### Manual dump (extra safety before a risky change)

```bash
pg_dump "postgresql://barberadmin:***@barber-prod-pg-<hash>...:5432/barber?sslmode=require" \
  -Fc -f barber-$(date +%F).dump          # keep this file OUT of Git
# restore into a fresh db:
pg_restore -d "postgresql://.../barber_new" barber-2026-09-10.dump
```

## Migration rollback

Prisma migrations are **forward-only** by design (`prisma migrate deploy`). There
is no automatic "down". Strategy:

1. **Prevention** — CI runs every migration against a real Postgres before merge;
   `deploy.yml` runs the `-migrate` job and **fails the deploy** if it fails, so a
   bad migration never reaches a running app.
2. **A migration that applied but is wrong** — write a **new** corrective
   migration (`prisma migrate dev --create-only`, edit, commit) and deploy it
   forward. Never edit an applied migration file.
3. **A migration that dropped/renamed data** — restore the DB via PITR to just
   before the deploy (steps above), then redeploy the *previous* image tag, then
   ship the corrected migration.
4. Additive migrations (this project's history so far: new columns/tables/indexes)
   are safe to leave in place even if you roll the app back.

## Container / app rollback

Container Apps keeps every revision.

```bash
# list revisions
az containerapp revision list -g barber-prod -n barber-prod-web -o table
# re-activate a previous one (instant, no rebuild)
az containerapp revision set-active -g barber-prod -n barber-prod-web \
  --revision barber-prod-web--<old-suffix>
```

Or re-run `deploy.yml` with an older commit SHA:
`Actions → Deploy → Run workflow` and set the target env; the workflow builds
`barber-saas:<old-sha>` and rolls it. **Check whether any migration shipped
between the two SHAs** — if so, the DB may be ahead of the old code. Additive
migrations are fine; a destructive one needs a PITR first.

The worker + cron jobs roll the same way (`az containerapp revision …` /
`az containerapp job update --image`).

## Redis

Redis holds only **ephemeral** data: the session cache (backed by the DB — a
flush just forces re-login), rate-limit counters (reset harmlessly), and the
BullMQ queues. Loss of Redis is a brief availability blip, not data loss.

- `Standard` tier (prod) has replication + automatic failover.
- If Redis is wiped: sessions require re-login; in-flight jobs that were queued
  but not yet processed are lost — the messaging retry cron (`cron-retry-messages`)
  re-drives any `Message` left `FAILED`, and reminders re-compute on the next
  `cron-reminders` run. Campaign delivery is resumable (idempotent per
  recipient), but a `RUNNING` campaign interrupted mid-flight may need
  `cancelCampaign` + recreate.

## Blob storage

`Standard_ZRS` (prod) / `Standard_LRS` (non-prod). Enable **soft delete for
blobs** + **versioning** in the Portal (Storage account → Data protection) — not
in the Bicep by default:

```bash
az storage account blob-service-properties update \
  --account-name barberprodst<hash> -g barber-prod \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-versioning true
```

Uploaded files (logos, covers, avatars) can then be restored per-blob. These are
non-critical assets — a lost logo is re-uploaded by the barbershop.

## Secrets recovery

- **Key Vault** has `enableSoftDelete` (30/90 days) and, in prod,
  `enablePurgeProtection`. A deleted secret/vault can be recovered:
  `az keyvault secret recover --vault-name <kv> --name <secret>`.
- Key Vault versions every secret — roll back a bad value with
  `az keyvault secret set` (creates a new current version) or by disabling the
  bad version.
- **You still keep the originals** in a password manager. If Key Vault is lost
  entirely: recreate the vault (Bicep), re-run `npm run keyvault:push`, redeploy.
- Rotating a leaked secret: revoke at the provider (Stripe/Meta/Resend/Anthropic
  dashboards) → new value in Key Vault → `az containerapp revision restart`.

## Disaster recovery (region loss)

1. New resource group in the DR region.
2. `az postgres flexible-server geo-restore` (prod geo-redundant backup) → new PG.
3. `az deployment group create` the Bicep in the DR RG, `appUrl` = a DR hostname,
   `database-url` pointed at the geo-restored server.
4. Re-run `npm run keyvault:push` for the DR vault; flip `secrets[]` to Key Vault.
5. Update DNS (CNAME) to the DR Container App; bind a managed cert.
6. Re-create the Stripe/WhatsApp webhook endpoints at the DR URL (or update the
   existing ones).
7. `npm run smoke -- https://<dr-hostname>`.

RPO ≈ the geo-backup lag (typically minutes–1h). RTO ≈ the time to run the above
(≈ 1–2h manual). Automating this into a second standing environment is a
post-launch improvement, not a launch blocker.

## Quarterly recovery drill

- [ ] PITR-restore prod PG to a throwaway server; run `prisma migrate status` +
      `npm run preflight` against it; delete it.
- [ ] `az containerapp revision set-active` to the previous web revision and back.
- [ ] Recover one Key Vault secret from a prior version.
- [ ] Confirm the last automated backup timestamp on the PG server.
