# ADR 0012 — Observability & production hardening

**Status:** accepted · **Date:** 2026-09-06

## Context

V1 features are complete; this closes the operational gaps before launch.

## Decisions

### Correlation ids

`middleware.ts` stamps `x-request-id` on every request (reusing an inbound value
from the Azure ingress / load balancer if present) and mirrors it onto the
response and the forwarded request headers. `src/lib/request-context.ts`
(`getRequestId()` / `reqLog()`) reads it from `next/headers` — no
`AsyncLocalStorage` (unavailable on the Edge middleware runtime and awkward to
thread through App Router). Logs are pino JSON to stdout → Log Analytics, with a
redaction list for secrets/PII.

### Health probes

- `GET /api/health/live` — liveness, **no dependencies**. A failing DB must not
  make Container Apps kill the container.
- `GET /api/health` — readiness: checks Postgres (fails → 503); Redis is
  non-critical (degrades, stays ready).

### Security headers

`next.config.ts` adds a baseline `Content-Security-Policy`
(`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`, scoped
`connect-src`/`frame-src` for Stripe/Anthropic/Meta) and, in production, HSTS
(`max-age=31536000; includeSubDomains; preload`). `script-src` still allows
`'unsafe-inline'` — a nonce-injection layer to remove it is a tracked follow-up.

### CI/CD

`.github/workflows/deploy.yml` in addition to `ci.yml`:

- staging deploys automatically on green `main`; production is
  `workflow_dispatch` gated by the `production` GitHub Environment (required
  reviewers).
- `az acr build` → `prisma migrate deploy` (forward-only, once, before any app
  rolls) → `az containerapp update --image` for web / worker / cron jobs →
  readiness smoke check. **No delete/destroy step**; rollback = redeploy an
  older SHA.
- Azure auth via OIDC federated credentials (no stored service-principal
  secret).

### Scope calls

- **E2E**: the DB-backed integration suite (Vitest against real Postgres,
  `RUN_DB_TESTS=1` in CI) covers the server-side path of all five critical
  flows — signup/onboarding, staff booking, public booking + payment webhook,
  chatbot tool booking, subscription webhook lifecycle. Full Playwright
  browser E2E of the five flows remains a follow-up (`tests/e2e/smoke.spec.ts`
  runs in CI); the dev server compile time on the current dev box makes
  interactive browser runs impractical there.
- **Cross-tenant isolation**: asserted in the scheduling / CRM / chatbot
  integration tests (every query is tenant-scoped and tested with a second
  tenant present). A dedicated exhaustive sweep is a follow-up.

## Consequences

- Correlation ids are best-effort: background jobs (worker, crons) run outside a
  request scope and log without one.
- The CSP will need per-integration `connect-src`/`frame-src` additions as new
  third parties are wired.
