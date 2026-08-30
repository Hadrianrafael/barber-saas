# Security baseline

Always-on controls (not optional, not behind a flag):

## Secrets
- No secret in the repo or in client bundles. Server-only via `src/env.ts`;
  Azure Key Vault in production (referenced as Container Apps secrets).
- Stripe / Anthropic / WhatsApp keys are **server-side only**. `.env` is
  git-ignored; `.gitignore` blocks `.env*`, `*.pem`, `*.key` before the first
  commit.

## AuthN / sessions
- Opaque session tokens; only SHA-256 hashes stored. httpOnly + `secure` (prod) +
  `SameSite=Lax`. Separate cookie for the admin realm, shorter TTL.
- bcrypt cost 12. Password policy ≥ 10 chars incl. letter + digit.
- Password reset revokes all sessions. Reset / verification tokens are single-use,
  hashed at rest, time-boxed (1 h / 24 h).
- No account enumeration on signup collision messaging, forgot-password, or
  resend-verification (uniform responses).

## AuthZ
- RBAC decided on the server for every mutation via `requireTenantContext`.
- Never trust client-supplied `tenantId` / role / JWT claims for permission.
- Tenant isolation enforced by `forTenant()` on all tenant-scoped queries.

## Input / output
- All external input validated with zod at the boundary (server actions, route
  handlers, webhooks).
- Prisma parameterizes queries; no string-built SQL. Raw SQL (rare) carries
  explicit tenant predicates.
- Security headers set in `next.config.ts` (nosniff, DENY frame, referrer
  policy, permissions policy).

## Rate limiting
- Redis fixed-window limiter on sign-in (per IP + per email), signup, password
  reset, resend-verification, and (later) webhooks and public booking.

## Webhooks
- Signature verified (`stripe.webhooks.constructEvent`) before any processing.
- Idempotent: `WebhookEvent` unique `(provider, eventId)` row inserted first;
  duplicates are a no-op.
- Payment/subscription state is written from webhooks, never from client
  success redirects.

## Data
- No card data stored — Stripe holds it (SAQ-A posture).
- PII kept out of logs (pino redaction list). Audit trail (`AuditLog`) for
  sensitive actions: permission changes, deletions, billing changes,
  impersonation.

## Pre-release gates (Slice 12)
- Automated cross-tenant isolation tests
- E2E on auth, booking, payment, webhook
- `dev-cybersecurity` review (OWASP Top 10, authz, upload, rate limiting)
