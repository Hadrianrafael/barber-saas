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
- Security headers set in `next.config.ts`: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy`, a baseline `Content-Security-Policy`
  (`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`,
  scoped `connect-src` for Stripe/Anthropic/Meta), and HSTS
  (`max-age=31536000; includeSubDomains; preload`) in production. A nonce-based
  CSP (removing `script-src 'unsafe-inline'`) is a follow-up.
- Every request carries an `x-request-id` correlation id (stamped by
  `middleware.ts`, echoing an inbound value from the Azure ingress); structured
  logs bind it via `src/lib/request-context.ts`.

## Rate limiting
- Redis fixed-window limiter (fail-open) on: sign-in (per IP + per email),
  signup, password reset, resend-verification, admin sign-in; public booking
  slot lookup (60/min) + submit (10 / 5 min) + manage (20 / 5 min); web-chat
  start (20 / 5 min) + send (30 / 2 min); review submit (10 / 5 min).

## Webhooks
- **Stripe** (`/api/webhooks/stripe`) + **Stripe Connect**
  (`/api/webhooks/stripe/connect`): separate signing secrets, signature verified
  (`stripe.webhooks.constructEvent`) before any processing; `provider` tag keeps
  the two ledgers isolated.
- **WhatsApp** (`/api/webhooks/whatsapp`): `GET` verify-token handshake; `POST`
  verifies `x-hub-signature-256` HMAC-SHA256 over the raw body with
  `WHATSAPP_APP_SECRET` (`timingSafeEqual`). Returns `200` inert when unconfigured.
- Idempotent: `WebhookEvent` unique `(provider, eventId)` row inserted first;
  duplicates are a no-op. Handlers also guard on state (e.g. `updateMany … where
  status: PENDING`) and de-dupe on the payment-intent id.
- Payment/subscription/appointment-confirmation state is written from webhooks,
  never from client success redirects.

## Chatbot (AI) authorization
- The assistant is **not a member role**. Its ~10 tools are fixed in
  `src/features/chatbot/tools.ts`; every query is hard-scoped to the
  conversation's `tenantId` and, for customer data, to the one customer bound to
  the conversation via `identify_customer`. Booking tools go through the same
  scheduling domain as staff. There is **no tool** for finance, roster,
  settings, other customers, campaigns or audit — the capability does not exist,
  so no prompt can reach it. Per-tenant config tunes voice only.

## Campaigns
- Marketing sends require an explicit, non-revoked opt-in on the channel — for
  **every** channel including e-mail (`canContact(…, "marketing")`), enforced
  both in the audience query and re-checked per recipient in the worker.

## Impersonation
- Only a valid admin session can start it. It mints a **non-admin** app session
  for the admin's own user with `impersonatedTenantId` set (OWNER power on that
  one tenant), revoking any prior app session on the browser. Always written to
  `AuditLog` (`admin.impersonation.start` with the impersonated owner's email).
  A persistent banner + one-click Exit in the tenant app; the admin cookie is
  never touched.

## Data
- No card data stored — Stripe holds it (SAQ-A posture).
- PII kept out of logs (pino redaction list). Audit trail (`AuditLog`) for
  sensitive actions: permission changes, deletions, billing changes,
  impersonation.

## Uploads
- Branding images (`uploadImageAction`): ≤ 4 MB, MIME in
  {png, jpeg, webp}, extension re-checked, stored via the storage abstraction
  (Azure Blob in prod, local disk dev-only).
- CSV import: ≤ 2 MB, `.csv` + MIME check, ≤ 5000 rows, parsed in-process
  (no shell-out), every row validated before any `Customer` write.

## Known follow-ups (tracked, not blockers)
- Nonce-based CSP (drop `script-src 'unsafe-inline'`).
- Full Playwright E2E of the 5 critical flows (server-side paths are covered by
  the DB-backed integration suite; the dev server does not compile fast enough
  in the current Windows/Node dev box for browser E2E — CI runs the smoke spec).
- Automated cross-tenant isolation test sweep (spot-covered today by the
  scheduling / CRM / chatbot integration tests, which assert tenant scoping).
- `dev-cybersecurity` deep review (OWASP Top 10) sign-off.
