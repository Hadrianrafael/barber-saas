# ADR 0015 — Go-live readiness (configuration phase, no scope change)

**Status:** accepted · **Date:** 2026-09-07

## Context

The V1 feature set and the launch hardening (ADR 0014) are done. This phase adds
the operational scaffolding to take the app to production **without touching the
V1 scope** — no new features, plans, providers or modules.

## Decisions

1. **Operational scripts** (`scripts/`, wired into `package.json`), all
   **secret-safe** (masked hints only, never a value):
   - `check:env` — required vars present? which integrations configured? Stripe
     test vs live. Exit 1 if a required var is missing/invalid.
   - `preflight` — real connectivity to Postgres, Redis, Azure Blob and Stripe
     with the current env.
   - `smoke` — post-deploy HTTP checks (`/api/health/live`, `/api/health`,
     public routes, a protected-route redirect, an unsigned-webhook rejection).
   - `keyvault:push` — maps a local git-ignored `.env.<env>` to the 16 Key Vault
     secret names and `az keyvault secret set`s each; `--dry-run` supported.

2. **Bicep — deployability fixes** (`infra/main.bicep`):
   - `AcrPull` role assignment for every app/job managed identity on the ACR
     (the `registries[].identity: 'system'` wiring is inert without it).
   - Removed an invalid `az.environment()` call; the blob endpoint suffix is a
     documented constant (`core.windows.net`, Azure public cloud) and the public
     URL uses `storage.properties.primaryEndpoints.blob`.
   - CI validates the template on every push (`az bicep build`).

3. **`.gitignore` hardening** — `.env.*` (so `.env.staging` / `.env.production`
   are ignored), plus `secrets/`, `.storage/`, `*.p12/.pfx/.crt`. `.env.example`
   stays tracked.

4. **CI** — `npm audit --omit=dev --audit-level=critical` (blocks only
   criticals; surfaces the rest) + the Bicep validation step.

5. **New docs**:
   - `docs/GO-LIVE-CHECKLIST.md` — the executable checklist, sections A–N, each
     row with status / owner (Claude|Hadrian) / command-or-URL / dependency /
     how-to-validate.
   - `docs/deployment/keyvault.md` — the 16 slots, identity grants, the push
     script, pointing `secrets[]` at Key Vault, rotation.
   - `docs/deployment/domain.md` — DNS/CNAME/TXT, managed cert, `APP_URL`, the
     full URL table (Stripe/WhatsApp/Resend), "no CORS / no OAuth callback".
   - `docs/deployment/backup-recovery.md` — PG PITR + geo-restore, migration
     rollback strategy, Container Apps revision rollback, Redis/Blob/secrets
     recovery, a region-loss DR runbook, a quarterly drill.
   - `docs/AZURE-COST-CHECKLIST.md` — which resources are billed, fixed vs
     variable, cost controls, where to find official prices (no prices quoted).

## Non-decisions (explicitly out of scope)

- `next@16` upgrade to clear the build-time `postcss` advisories — a deliberate
  breaking change for later; CI gates on criticals only.
- Automating the DR environment as a standing second region.
- VNet / private endpoints / Front Door — tracked in `infra/README.md`, not a
  first-launch blocker.

## Consequences

- The repo is `READY FOR CONFIGURATION`: every code/infra/script/doc artifact is
  in place. Reaching `READY FOR STAGING` / `READY FOR PRODUCTION` now depends
  only on external accounts, credentials, DNS and the deploy runs — all itemised
  in `docs/GO-LIVE-CHECKLIST.md`.
