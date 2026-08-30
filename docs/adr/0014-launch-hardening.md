# ADR 0014 — Launch hardening

**Status:** accepted · **Date:** 2026-09-07

## Context

Pre-launch audit of the whole project for staging/production readiness. The
application code was solid; the gaps were in the deployment story (Bicep vs
`deploy.yml` diverged, one image built the wrong CMD for web, a scheduled job had
no Bicep resource, secrets weren't wired) plus one real cross-tenant defect.

## Decisions

1. **One container image, three roles.** The Dockerfile is a single `runner`
   stage: Next.js standalone `server.js` + the full `node_modules` + `src` + tsx.
   The web Container App uses the default CMD; the worker and the scheduled jobs
   override `command` in Bicep. Removes the previous `web` / `worker` target
   split that made `deploy.yml`'s single image run the worker CMD for the web
   app.

2. **Bicep is the source of truth for names and wiring.** Resources are
   `barber-<environment>-<role>` (`web`, `worker`, `cron-reminders`,
   `cron-retry-messages`, `migrate`). `deploy.yml` maps the GitHub Environment
   name (`staging` | `production`) to the Bicep short name (`staging` | `prod`)
   and targets those names. `infra/README.md`, `docs/deployment/azure.md` and the
   new `docs/GO-LIVE.md` all match.

3. **Migrations run inside the Container Apps environment.** A manual
   `barber-<env>-migrate` job runs `npx prisma migrate deploy`; `deploy.yml`
   starts it and waits for `Succeeded`/`Failed` before rolling the apps. This
   works even when Postgres is on a VNet the CI runner can't reach. Forward-only,
   never destructive.

4. **Every integration secret slot is declared in Bicep** with an empty
   placeholder value + the matching `env` `secretRef`. `src/env.ts` reads an
   empty value as "not configured" and degrades cleanly. Go-live = put values in
   Key Vault and switch `value: ''` → `keyVaultUrl`. `database-url`, `redis-url`
   and `azure-storage-connection-string` are derived from the provisioned
   resources.

5. **Probes split.** Liveness + startup → `/api/health/live` (no dependencies);
   readiness → `/api/health` (Postgres hard, Redis degrades). A failing DB must
   not restart the container.

6. **Cross-tenant fix — loyalty.** `adjustPoints`, `redeemReward` and
   `getLoyaltySummary` accepted a `customerId` without checking it belonged to
   the tenant. A crafted request from another tenant's OWNER/MANAGER could adjust
   or redeem points for a foreign customer. Added `assertCustomerInTenant()`.
   The general principle (re-verify every related id server-side, the UI is not
   the authority) is now stated in `docs/SECURITY.md` and enforced by
   `tests/integration/tenant-isolation.int.test.ts`.

7. **CSV formula injection** in the finance export is neutralised (cells
   starting with `= + - @` or a control char are prefixed with `'`).

8. **`docs/GO-LIVE.md`** — the ordered runbook (accounts → Stripe → Connect →
   Resend → WhatsApp → AI → Azure → Key Vault → domain → webhooks → staging →
   test → production → Live Mode) + a verifiable checklist. Explicitly separates
   "done in code" from "depends on you".

## Consequences

- The Azure network hardening (VNet, private endpoints, Front Door/WAF) is still
  a documented TODO in `infra/README.md` — it does not block a first launch but
  should be done before real traffic scale.
- Full browser E2E of the five flows remains a follow-up; the golden path is now
  covered at the service layer by `tests/integration/golden-path.int.test.ts`.
